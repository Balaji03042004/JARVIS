'use strict';

const cameraService = require('../services/cameraService');
const logger        = require('../utils/logger');

// GET /api/camera/devices
async function listDevices(req, res) {
  const cameras = await cameraService.listCameras();
  const ffmpeg  = await cameraService.checkFfmpeg();
  res.json({ cameras, ffmpegAvailable: ffmpeg, total: cameras.length });
}

// GET /api/camera/status
async function status(req, res) {
  const cameras = await cameraService.listCameras();
  const ffmpeg  = await cameraService.checkFfmpeg();
  const rec     = cameraService.getRecordingStatus();
  res.json({
    ffmpegAvailable: ffmpeg,
    cameras,
    defaultCamera: cameras[0] || null,
    ...rec
  });
}

// POST /api/camera/open
async function openApp(req, res) {
  const result = await cameraService.openCameraApp();
  res.json(result);
}

// POST /api/camera/capture  { label? }
async function capture(req, res) {
  try {
    const label  = req.body?.label || '';
    const result = await cameraService.captureImage(label);
    if (!result.success) return res.status(500).json(result);
    res.json(result);
  } catch (err) {
    logger.error('capture error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/camera/record/start  { duration? }
async function startRecording(req, res) {
  try {
    const duration = parseInt(req.body?.duration || 0, 10);
    const result   = await cameraService.startRecording(duration);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/camera/record/stop
async function stopRecording(req, res) {
  const result = await cameraService.stopRecording();
  res.json(result);
}

// GET /api/camera/captures?type=images|videos|all
async function listCaptures(req, res) {
  const type  = req.query.type || 'all';
  const files = cameraService.getCapturedFiles(type);
  res.json({ files, total: files.length });
}

// DELETE /api/camera/captures/:filename
async function deleteCapture(req, res) {
  const result = cameraService.deleteCapture(req.params.filename);
  res.json(result);
}

// POST /api/camera/set-device  { name }
async function setDevice(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  cameraService.setCameraName(name);
  res.json({ success: true, camera: name });
}

module.exports = {
  listDevices,
  status,
  openApp,
  capture,
  startRecording,
  stopRecording,
  listCaptures,
  deleteCapture,
  setDevice,
};
