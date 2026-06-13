'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { exec }      = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { fetch: undicicFetch } = require('undici');

const logger = require('../utils/logger');
const { openInBrowser } = require('./systemService');

// ─── Music Library ────────────────────────────────────────────────────────────

const AUDIO_EXTS = new Set(['.mp3','.wav','.flac','.aac','.ogg','.wma','.m4a','.opus','.ape','.aiff']);
let _musicCache = null;

function _scanMusicDir(dir, depth, results) {
  if (depth > 4) return;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { _scanMusicDir(full, depth + 1, results); }
      else {
        const ext = path.extname(e.name).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
          results.push({
            name:      path.basename(e.name, ext),
            file:      e.name, ext,
            fullPath:  full,
            nameLower: path.basename(e.name, ext).toLowerCase()
          });
        }
      }
    }
  } catch (_) {}
}

async function getMusicLibrary(forceRefresh = false) {
  if (_musicCache && !forceRefresh) return _musicCache;
  const dirs = [
    path.join(os.homedir(), 'Music'),
    'C:\\Users\\Public\\Music',
    path.join(os.homedir(), 'Downloads'),
    'D:\\Music', 'E:\\Music',
  ];
  const tracks = [];
  for (const d of dirs) { if (fs.existsSync(d)) _scanMusicDir(d, 0, tracks); }
  _musicCache = tracks;
  logger.info(`Music scan: ${tracks.length} tracks found`);
  return tracks;
}

function fuzzyFindTrack(tracks, query) {
  const q = query.toLowerCase().trim();
  let m = tracks.find(t => t.nameLower === q);
  if (m) return m;
  m = tracks.find(t => t.nameLower.startsWith(q));
  if (m) return m;
  m = tracks.find(t => t.nameLower.includes(q));
  if (m) return m;
  const words = q.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 1) {
    m = tracks.find(t => words.every(w => t.nameLower.includes(w)));
    if (m) return m;
    m = tracks.find(t => words.some(w => t.nameLower.includes(w)));
    if (m) return m;
  }
  return null;
}

async function musicAction(action, query, filePath, key, refresh) {
  if (action === 'scan') {
    const tracks = await getMusicLibrary(refresh === true);
    return { success: true, count: tracks.length, tracks: tracks.map(t => ({ name: t.name, file: t.file, path: t.fullPath })) };
  }
  if (action === 'play') {
    if (!filePath) return { success: false, error: 'No file path' };
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    exec(`start "" "${filePath}"`, err => { if (err) logger.warn('Music play error: ' + err.message); });
    return { success: true, playing: path.basename(filePath) };
  }
  if (action === 'search') {
    if (!query) return { success: false, error: 'No query' };
    const tracks = await getMusicLibrary();
    const match  = fuzzyFindTrack(tracks, query);
    return { success: !!match, match: match || null };
  }
  if (action === 'control') {
    const KEY_MAP = { pause: 0xB3, play: 0xB3, toggle: 0xB3, next: 0xB0, previous: 0xB1, stop: 0xB2, mute: 0xAD, 'volume up': 0xAF, 'volume down': 0xAE };
    const vk = KEY_MAP[key];
    if (!vk) return { success: false, error: 'Unknown control key' };
    const ps = `$s=New-Object -ComObject WScript.Shell;$s.SendKeys([char]${vk})`;
    exec(`cmd /c "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command "${ps}"`, err => { if (err) logger.warn(err.message); });
    return { success: true };
  }
  return { success: false, error: 'Unknown action' };
}

// ─── Spotify ──────────────────────────────────────────────────────────────────

async function spotifyAction(action, query, key) {
  if (action === 'search-play') {
    const q      = (query || '').trim();
    const webUrl = q ? `https://open.spotify.com/search/${encodeURIComponent(q)}` : 'https://open.spotify.com';
    const spotUri = q ? `spotify:search:${q}` : 'spotify:';
    exec(`start "" "${spotUri}"`, desktopErr => {
      if (desktopErr) exec(`start "" "${webUrl}"`, () => {});
    });
    setTimeout(() => {
      const ps = [
        '$ErrorActionPreference = "SilentlyContinue"',
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type @"',
        'using System; using System.Runtime.InteropServices;',
        'public class SpotifyWin {',
        '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
        '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);',
        '}',
        '"@',
        '$p = Get-Process | Where-Object { $_.MainWindowTitle -match "Spotify" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
        'if ($p) {',
        '  [SpotifyWin]::ShowWindow($p.MainWindowHandle, 9)',
        '  [SpotifyWin]::SetForegroundWindow($p.MainWindowHandle)',
        '  Start-Sleep -Milliseconds 800',
        '  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
        '  Start-Sleep -Milliseconds 250',
        '  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
        '  Start-Sleep -Milliseconds 600',
        '  [System.Windows.Forms.SendKeys]::SendWait(" ")',
        '}',
      ].join('\n');
      const tmpFile = path.join(os.tmpdir(), `jarvis_splay_${Date.now()}.ps1`);
      fs.writeFileSync(tmpFile, ps, 'utf8');
      exec(`cmd /c "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmpFile}"`, () => { fs.unlink(tmpFile, () => {}); });
    }, 3800);
    logger.info(`Spotify: search-play "${q}"`);
    return { success: true, url: webUrl };
  }

  if (action === 'control') {
    const spotifyKeys = { play: ' ', pause: ' ', toggle: ' ', stop: ' ', next: '^{RIGHT}', previous: '^{LEFT}', mute: '^{DOWN}', 'volume up': '^{UP}', 'volume down': '^{DOWN}' };
    const sendKey = spotifyKeys[key] || ' ';
    const escapedKey = sendKey.replace(/"/g, '`"');
    const ps = [
      '$ErrorActionPreference = "SilentlyContinue"',
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type @"',
      'using System; using System.Runtime.InteropServices;',
      'public class SpotifyCtrl { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }',
      '"@',
      '$p = Get-Process | Where-Object { $_.MainWindowTitle -match "Spotify" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
      'if ($p) {',
      '  [SpotifyCtrl]::SetForegroundWindow($p.MainWindowHandle)',
      '  Start-Sleep -Milliseconds 450',
      `  [System.Windows.Forms.SendKeys]::SendWait("${escapedKey}")`,
      '}',
    ].join('\n');
    const tmpFile = path.join(os.tmpdir(), `jarvis_sctrl_${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, ps, 'utf8');
    exec(`cmd /c "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmpFile}"`, () => { fs.unlink(tmpFile, () => {}); });
    return { success: true };
  }

  return { success: false, error: 'Unknown action' };
}

// ─── YouTube Search ───────────────────────────────────────────────────────────

async function youtubeSearch(query) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const resp = await undicicFetch(searchUrl, {
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const html      = await resp.text();
  const rawMatches = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/g) || [];
  const videoIds   = [...new Set(rawMatches.map(m => m.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)[1]))].slice(0, 8);
  const titleRaw   = html.match(/"title":\{"runs":\[\{"text":"([^"]{1,150})"/g) || [];
  const titles     = titleRaw.slice(0, 8).map(m => { const tm = m.match(/"text":"([^"]+)"/); return tm ? tm[1] : ''; });
  if (!videoIds.length) return { success: false, videoIds: [], error: 'No results found' };
  logger.info(`YouTube search "${query}" → ${videoIds.length} results`);
  return { success: true, videoIds, titles };
}

module.exports = { musicAction, spotifyAction, youtubeSearch };
