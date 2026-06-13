'use strict';

const browserService = require('../services/browserService');
const logger         = require('../utils/logger');

// GET /api/browser/status
function status(req, res) {
  const page = browserService.getPageState();
  res.json({
    extensionConnected: browserService.isConnected(),
    currentPage: page
  });
}

// POST /api/browser/command  { action, data }
async function command(req, res) {
  const { action, data = {} } = req.body;
  if (!action) return res.status(400).json({ error: 'action is required' });

  try {
    const result = await browserService.sendCommand(action, data);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/browser/navigate  { url }
async function navigate(req, res) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const result  = await browserService.sendCommand('navigate', { url: fullUrl });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/browser/youtube  { action, data }
async function youtube(req, res) {
  const { action, data = {} } = req.body;
  const ytActions = ['yt_play','yt_pause','yt_toggle','yt_next','yt_mute','yt_unmute',
                     'yt_fullscreen','yt_volume','yt_volume_up','yt_volume_down',
                     'yt_seek','yt_speed','yt_like','yt_info','yt_search'];
  if (!ytActions.includes(action)) {
    return res.status(400).json({ error: `Invalid YouTube action. Use: ${ytActions.join(', ')}` });
  }
  try {
    const result = await browserService.sendCommand(action, data);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { status, command, navigate, youtube };
