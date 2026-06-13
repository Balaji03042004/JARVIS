'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — Integration Controller
// Handles Spotify, GitHub, Habits endpoints
// ═══════════════════════════════════════════════════════════════════════════════

const spotifyService = require('../services/spotifyService');
const githubService  = require('../services/githubService');
const habitService   = require('../services/habitService');
const logger         = require('../utils/logger');

// ─── Helper ───────────────────────────────────────────────────────────────────
function uid(req) {
  return (req.body?.userId || req.query?.userId || 'balaji').toLowerCase().replace(/\s+/g, '_');
}

// ══════════════════════════════════════════════════════════════════════════════
// SPOTIFY
// ══════════════════════════════════════════════════════════════════════════════

exports.spotifyStatus = async (req, res) => {
  res.json(spotifyService.getStatus());
};

exports.spotifySearch = async (req, res) => {
  const { q, type = 'track' } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
  try {
    let results;
    if (type === 'playlist') results = await spotifyService.searchPlaylist(q);
    else if (type === 'artist') results = await spotifyService.searchArtist(q);
    else results = await spotifyService.searchTrack(q);
    res.json({ results, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.spotifyPlay = async (req, res) => {
  const { query, type = 'track' } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  try {
    const r = type === 'playlist'
      ? await spotifyService.playPlaylistByName(query)
      : await spotifyService.playTrackByName(query);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.spotifyControl = async (req, res) => {
  const { action } = req.params;
  const actions = {
    pause:    spotifyService.mediaPause,
    play:     spotifyService.mediaPlay,
    next:     spotifyService.mediaNext,
    prev:     spotifyService.mediaPrev,
    stop:     spotifyService.mediaStop,
    vol_up:   spotifyService.mediaVolUp,
    vol_down: spotifyService.mediaVolDown,
    mute:     spotifyService.mediaMute,
  };
  const fn = actions[action];
  if (!fn) return res.status(400).json({ error: `Unknown action: ${action}` });
  try {
    await fn();
    res.json({ success: true, action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GITHUB
// ══════════════════════════════════════════════════════════════════════════════

exports.githubStatus = async (req, res) => {
  res.json(githubService.getStatus());
};

exports.githubProfile = async (req, res) => {
  try {
    const user = await githubService.getAuthenticatedUser();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.githubRepos = async (req, res) => {
  try {
    const repos = await githubService.getRepos(parseInt(req.query.limit) || 10);
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.githubIssues = async (req, res) => {
  const { repo } = req.params;
  const { state = 'open' } = req.query;
  try {
    const issues = await githubService.getIssues(repo, state);
    res.json({ issues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.githubCreateIssue = async (req, res) => {
  const { repo } = req.params;
  const { title, body = '', labels = [] } = req.body;
  if (!title) return res.status(400).json({ error: 'Missing title' });
  try {
    const issue = await githubService.createIssue(repo, title, body, labels);
    res.json(issue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.githubPRs = async (req, res) => {
  const { repo } = req.params;
  try {
    const prs = await githubService.getPRs(repo, req.query.state || 'open');
    res.json({ prs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.githubNotifications = async (req, res) => {
  try {
    const notifs = await githubService.getNotifications(req.query.all !== 'true');
    res.json({ notifications: notifs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.githubSearch = async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const repos = await githubService.searchRepos(q);
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// HABITS
// ══════════════════════════════════════════════════════════════════════════════

exports.habitsSummary = async (req, res) => {
  const userId = uid(req);
  try {
    const [daily, topApps, suggestions] = await Promise.all([
      habitService.getDailySummary(userId),
      habitService.getTopApps(userId),
      habitService.getSuggestions(userId)
    ]);
    res.json({ daily, topApps, suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.habitsTrack = async (req, res) => {
  const userId = uid(req);
  const { actionType, data = {} } = req.body;
  if (!actionType) return res.status(400).json({ error: 'Missing actionType' });
  try {
    await habitService.trackAction(userId, actionType, data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.habitsHistory = async (req, res) => {
  const userId = uid(req);
  try {
    const habits = await habitService.getHabits(userId, parseInt(req.query.days) || 30);
    res.json({ habits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.habitsBriefing = async (req, res) => {
  const userId = uid(req);
  try {
    const briefing = await habitService.getMorningBriefing(userId);
    res.json({ briefing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
