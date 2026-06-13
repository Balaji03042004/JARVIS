'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/integrationController');

// ── Spotify ───────────────────────────────────────────────────────────────────
router.get ('/spotify/status',        ctrl.spotifyStatus);
router.get ('/spotify/search',        ctrl.spotifySearch);      // ?q=...&type=track|playlist|artist
router.post('/spotify/play',          ctrl.spotifyPlay);        // { query, type }
router.post('/spotify/control/:action', ctrl.spotifyControl);   // :action = pause|play|next|prev|vol_up|vol_down|mute

// ── GitHub ────────────────────────────────────────────────────────────────────
router.get ('/github/status',                   ctrl.githubStatus);
router.get ('/github/profile',                  ctrl.githubProfile);
router.get ('/github/repos',                    ctrl.githubRepos);              // ?limit=10
router.get ('/github/repos/:repo/issues',       ctrl.githubIssues);             // ?state=open|closed
router.post('/github/repos/:repo/issues',       ctrl.githubCreateIssue);        // { title, body, labels }
router.get ('/github/repos/:repo/pulls',        ctrl.githubPRs);                // ?state=open
router.get ('/github/notifications',            ctrl.githubNotifications);       // ?all=true
router.get ('/github/search',                   ctrl.githubSearch);             // ?q=...

// ── Habits / Learning ─────────────────────────────────────────────────────────
router.get ('/habits/summary',    ctrl.habitsSummary);   // ?userId=...
router.post('/habits/track',      ctrl.habitsTrack);     // { actionType, data }
router.get ('/habits/history',    ctrl.habitsHistory);   // ?userId=...&days=30
router.get ('/habits/briefing',   ctrl.habitsBriefing);  // morning suggestions

module.exports = router;
