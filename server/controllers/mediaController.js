'use strict';

const logger       = require('../utils/logger');
const mediaService = require('../services/mediaService');
const { openInBrowser } = require('../services/systemService');

exports.music = async (req, res) => {
  const { action, query, filePath, key, refresh } = req.body;
  try {
    const result = await mediaService.musicAction(action, query, filePath, key, refresh);
    res.json(result);
  } catch (e) {
    res.status(400).json({ success: false, error: 'Unknown action' });
  }
};

exports.spotify = async (req, res) => {
  const { action, query, key } = req.body;
  try {
    const result = await mediaService.spotifyAction(action, query, key);
    res.json(result);
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
};

exports.youtubeSearch = async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, error: 'No query' });
  try {
    const result = await mediaService.youtubeSearch(query);
    res.json(result);
  } catch (e) {
    logger.error('YouTube search error: ' + e.message);
    res.json({ success: false, error: e.message, videoIds: [] });
  }
};

exports.browse = async (req, res) => {
  const { url, preferChrome } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'No URL provided' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
  const result = await openInBrowser(url, !!preferChrome);
  if (!result.success) return res.status(500).json(result);
  res.json(result);
};
