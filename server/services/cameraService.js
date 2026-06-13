'use strict';

// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS Camera Service                                   ║
// ║  Uses ffmpeg (DirectShow) to control webcam on Windows   ║
// ║  Capabilities: capture, record, list devices, analyze    ║
// ╚══════════════════════════════════════════════════════════╝

const { exec, spawn } = require('child_process');
const { promisify }   = require('util');
const path            = require('path');
const fs              = require('fs');
const logger          = require('./logger');

const execAsync = promisify(exec);

// ─── Captures folder ─────────────────────────────────────────────────────────
const CAPTURES_DIR = path.join(__dirname, '..', '..', 'public', 'captures');
if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

// Active recording process (one at a time)
let _recordingProcess = null;
let _recordingFile    = null;

// Cached camera name (detected once)
let _cameraName = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function publicUrl(filename) {
  return `/captures/${filename}`;
}

// ─── Detect Available Cameras ────────────────────────────────────────────────

async function listCameras() {
  try {
    // ffmpeg lists DirectShow devices; it outputs to stderr
    const { stderr } = await execAsync(
      'ffmpeg -list_devices true -f dshow -i dummy 2>&1',
      { timeout: 8000 }
    ).catch(e => ({ stderr: e.stderr || e.stdout || '' }));

    const lines   = (stderr || '').split('\n');
    const cameras = [];
    let inVideo   = false;

    for (const line of lines) {
      if (line.includes('DirectShow video devices')) { inVideo = true; continue; }
      if (line.includes('DirectShow audio devices')) { inVideo = false; }
      if (inVideo) {
        const m = line.match(/"([^"]+)"/);
        if (m) cameras.push(m[1]);
      }
    }
    return cameras;
  } catch (err) {
    logger.error('listCameras error: ' + err.message);
    return [];
  }
}

async function getDefaultCamera() {
  if (_cameraName) return _cameraName;
  const cameras = await listCameras();
  if (cameras.length === 0) return null;
  _cameraName = cameras[0];
  logger.info('Default camera: ' + _cameraName);
  return _cameraName;
}

// Allows overriding the detected camera name
function setCameraName(name) {
  _cameraName = name;
}

// ─── Check ffmpeg ─────────────────────────────────────────────────────────────

async function checkFfmpeg() {
  try {
    await execAsync('ffmpeg -version', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Open Windows Camera App ─────────────────────────────────────────────────

async function openCameraApp() {
  try {
    await execAsync('start microsoft.windows.camera:');
    return { success: true, message: 'Windows Camera app opened' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── Capture Single Image ─────────────────────────────────────────────────────

async function captureImage(label = '') {
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return { success: false, message: 'ffmpeg not found. Install from https://ffmpeg.org/download.html and add to PATH.' };
  }

  const camera = await getDefaultCamera();
  if (!camera) {
    return { success: false, message: 'No camera detected. Make sure your webcam is connected.' };
  }

  const filename = `capture_${label ? label + '_' : ''}${timestamp()}.jpg`;
  const outPath  = path.join(CAPTURES_DIR, filename);

  try {
    // -f dshow = DirectShow (Windows webcam API)
    // -frames:v 1 = capture exactly 1 frame
    // -video_size hd720 = 1280x720
    await execAsync(
      `ffmpeg -f dshow -i video="${camera}" -frames:v 1 -video_size hd720 -y "${outPath}"`,
      { timeout: 15000 }
    );

    const stat = fs.statSync(outPath);
    logger.info(`Image captured: ${filename} (${(stat.size / 1024).toFixed(1)} KB)`);
    return {
      success:  true,
      filename,
      path:     outPath,
      url:      publicUrl(filename),
      size:     stat.size,
      camera,
      message:  `Image captured: ${filename}`
    };
  } catch (err) {
    // ffmpeg exits with error but may still write the file
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      const stat = fs.statSync(outPath);
      return { success: true, filename, path: outPath, url: publicUrl(filename), size: stat.size, camera, message: `Image captured: ${filename}` };
    }
    logger.error('captureImage error: ' + err.message);
    return { success: false, message: `Capture failed: ${err.stderr || err.message}` };
  }
}

// ─── Start Video Recording ────────────────────────────────────────────────────

async function startRecording(durationSec = 0) {
  if (_recordingProcess) {
    return { success: false, message: 'Already recording. Stop current recording first.' };
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return { success: false, message: 'ffmpeg not found.' };

  const camera = await getDefaultCamera();
  if (!camera) return { success: false, message: 'No camera detected.' };

  const filename = `video_${timestamp()}.mp4`;
  const outPath  = path.join(CAPTURES_DIR, filename);
  _recordingFile = filename;

  const args = ['-f', 'dshow', '-i', `video=${camera}`, '-vcodec', 'libx264', '-y'];
  if (durationSec > 0) args.push('-t', String(durationSec));
  args.push(outPath);

  _recordingProcess = spawn('ffmpeg', args);
  _recordingProcess.on('exit', () => { _recordingProcess = null; });

  logger.info(`Recording started → ${filename}${durationSec ? ` (${durationSec}s)` : ''}`);
  return {
    success:  true,
    filename,
    url:      publicUrl(filename),
    message:  `Recording started${durationSec ? ` (auto-stops after ${durationSec}s)` : '. Say "stop recording" to stop.'}`
  };
}

// ─── Stop Video Recording ─────────────────────────────────────────────────────

async function stopRecording() {
  if (!_recordingProcess) {
    return { success: false, message: 'No recording in progress.' };
  }

  // Send 'q' to ffmpeg stdin to gracefully stop
  _recordingProcess.stdin?.write('q');
  _recordingProcess.kill('SIGTERM');
  _recordingProcess = null;

  const filename = _recordingFile;
  _recordingFile  = null;

  logger.info('Recording stopped: ' + filename);
  return {
    success:  true,
    filename,
    url:      publicUrl(filename),
    message:  `Recording saved: ${filename}`
  };
}

// ─── List Captured Files ──────────────────────────────────────────────────────

function getCapturedFiles(type = 'all') {
  const files = fs.readdirSync(CAPTURES_DIR).filter(f => {
    if (type === 'images') return /\.(jpg|jpeg|png)$/i.test(f);
    if (type === 'videos') return /\.(mp4|avi|mov)$/i.test(f);
    return /\.(jpg|jpeg|png|mp4|avi|mov)$/i.test(f);
  });

  return files.map(f => {
    const fPath = path.join(CAPTURES_DIR, f);
    const stat  = fs.statSync(fPath);
    return {
      filename:  f,
      url:       publicUrl(f),
      type:      /\.(mp4|avi|mov)$/i.test(f) ? 'video' : 'image',
      size:      stat.size,
      createdAt: stat.birthtime
    };
  }).sort((a, b) => b.createdAt - a.createdAt); // newest first
}

// ─── Delete a Captured File ───────────────────────────────────────────────────

function deleteCapture(filename) {
  // Sanitize — no path traversal
  const safe = path.basename(filename);
  const fPath = path.join(CAPTURES_DIR, safe);
  if (!fs.existsSync(fPath)) return { success: false, message: 'File not found' };
  fs.unlinkSync(fPath);
  logger.info('Deleted capture: ' + safe);
  return { success: true, message: `Deleted: ${safe}` };
}

// ─── Recording Status ─────────────────────────────────────────────────────────

function isRecording() {
  return _recordingProcess !== null;
}

function getRecordingStatus() {
  return {
    recording: isRecording(),
    filename:  _recordingFile || null
  };
}

// ─── Parse Camera Intent ──────────────────────────────────────────────────────
// Detects camera commands from chat messages

const CAMERA_INTENTS = [
  { re: /\b(open|launch|start)\s+(camera|webcam|cam)\b/i,           action: 'open_app'       },
  { re: /\b(take|capture|snap|click)\s+(a\s+)?(photo|picture|pic|image|selfie|screenshot of me)\b/i, action: 'capture'  },
  { re: /\b(start|begin)\s+(recording|video|record)\b/i,            action: 'start_recording' },
  { re: /\b(record\s+(video|me)|video\s+record)\b/i,                action: 'start_recording' },
  { re: /\brecord\s+for\s+(\d+)\s*(sec|second|min|minute)s?\b/i,   action: 'start_recording', timed: true },
  { re: /\b(stop|end)\s+(recording|video|record)\b/i,               action: 'stop_recording'  },
  { re: /\b(show|list|view)\s+(captures?|photos?|pictures?|videos?|recordings?)\b/i, action: 'list'  },
  { re: /\b(list|show)\s+(cameras?|webcams?|devices?)\b/i,          action: 'list_cameras'    },
  { re: /\bcamera\s+status\b/i,                                     action: 'status'          },
];

function parseCameraIntent(message) {
  const msg = String(message || '');

  // Check timed record first
  const timedMatch = msg.match(/record\s+for\s+(\d+)\s*(sec|second|min|minute)s?\b/i);
  if (timedMatch) {
    let secs = parseInt(timedMatch[1], 10);
    if (/min/i.test(timedMatch[2])) secs *= 60;
    return { action: 'start_recording', duration: secs };
  }

  for (const intent of CAMERA_INTENTS) {
    if (intent.re.test(msg)) {
      return { action: intent.action };
    }
  }
  return null;
}

module.exports = {
  listCameras,
  getDefaultCamera,
  setCameraName,
  checkFfmpeg,
  openCameraApp,
  captureImage,
  startRecording,
  stopRecording,
  getCapturedFiles,
  deleteCapture,
  isRecording,
  getRecordingStatus,
  parseCameraIntent,
  CAPTURES_DIR,
};
