'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — Smart Habit & Learning Service
// Works with both Supabase PostgreSQL and file-based DB (auto-routed via adapter)
// ═══════════════════════════════════════════════════════════════════════════════

const { adapter } = require('../utils/db');
const logger = require('../utils/logger');

// ─── Action Type Categories ───────────────────────────────────────────────────

const ACTION_TYPES = {
  APP_OPEN:       'app_open',         // "open notepad" → data: { app: "notepad" }
  MUSIC_PLAY:     'music_play',       // Spotify / YouTube play → data: { track: "..." }
  BROWSER:        'browser',          // YouTube, navigate → data: { action, url }
  CHAT_TOPIC:     'chat_topic',       // AI topic discussion → data: { topic }
  FILE_OP:        'file_op',          // file open/create → data: { type }
  PHONE_CALL:     'phone_call',       // call made → data: { contact }
  CAMERA:         'camera',           // photo/video → data: { type }
  SYSTEM:         'system',           // shell commands → data: { cmd }
  SEARCH:         'search',           // web searches → data: { query }
};

// ─── Track an Action ──────────────────────────────────────────────────────────

async function trackAction(userId, actionType, data = {}) {
  if (!userId || !actionType) return;
  const now       = new Date();
  const hourOfDay = now.getHours();
  const dayOfWeek = now.getDay();
  const dataStr   = JSON.stringify(data).slice(0, 500);
  try {
    await adapter.habits.insert(userId, actionType, dataStr, hourOfDay, dayOfWeek);
  } catch (err) {
    logger.warn('Habit track failed: ' + err.message);
  }
}

// ─── Get Habit Summary ────────────────────────────────────────────────────────

async function getHabits(userId, days = 30) {
  try {
    return await adapter.habits.aggregate(userId, days);
  } catch (err) {
    logger.warn('Get habits failed: ' + err.message);
    return null;
  }
}

async function getTopApps(userId, limit = 5) {
  try {
    const rows = await adapter.habits.aggregate(userId, 30, ACTION_TYPES.APP_OPEN, null);
    return rows.slice(0, limit).map(r => {
      try {
        const d = JSON.parse(r.action_data);
        return { app: d.app, count: parseInt(r.cnt) };
      } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function getTimePatterns(userId) {
  try {
    const currentHour = new Date().getHours();
    const rows = await adapter.habits.aggregate(userId, 14, null, currentHour);
    return rows.slice(0, 5).map(r => {
      try {
        return { type: r.action_type, data: JSON.parse(r.action_data), count: parseInt(r.cnt) };
      } catch { return null; }
    }).filter(Boolean);
  } catch {
    return null;
  }
}

async function getDailySummary(userId) {
  try {
    return await adapter.habits.countByType(userId, 24);
  } catch {
    return null;
  }
}

// ─── Generate Suggestions ─────────────────────────────────────────────────────

async function getSuggestions(userId) {
  const suggestions = [];
  const patterns    = await getTimePatterns(userId);
  const topApps     = await getTopApps(userId, 3);
  const currentHour = new Date().getHours();
  const greeting    = currentHour < 12 ? 'morning' : currentHour < 17 ? 'afternoon' : 'evening';

  // Suggest top apps they usually open at this hour
  if (patterns && patterns.length > 0) {
    const appPattern = patterns.find(p => p.type === ACTION_TYPES.APP_OPEN);
    if (appPattern?.data?.app) {
      suggestions.push(`You usually open **${appPattern.data.app}** around this time — want me to launch it?`);
    }
    const musicPattern = patterns.find(p => p.type === ACTION_TYPES.MUSIC_PLAY);
    if (musicPattern?.data?.track) {
      suggestions.push(`You often listen to "${musicPattern.data.track}" in the ${greeting}.`);
    }
  }

  // Overall top apps hint
  if (topApps.length > 0) {
    const names = topApps.slice(0, 3).map(a => a.app).join(', ');
    suggestions.push(`Your most used apps this month: ${names}.`);
  }

  return suggestions;
}

// ─── Build Context String for Prompt Injection ────────────────────────────────

async function getHabitContext(userId) {
  const [topApps, patterns, daily] = await Promise.all([
    getTopApps(userId, 5),
    getTimePatterns(userId),
    getDailySummary(userId)
  ]);

  const lines = [];

  if (topApps.length > 0) {
    lines.push(`Most-used apps: ${topApps.map(a => `${a.app} (×${a.count})`).join(', ')}`);
  }

  if (daily?.total) {
    lines.push(`Today's activity: ${daily.total} actions`);
    const types = Object.entries(daily.byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t, c]) => `${t.replace('_', ' ')} ×${c}`)
      .join(', ');
    if (types) lines.push(`  → ${types}`);
  }

  if (patterns?.length > 0) {
    const appPat = patterns.find(p => p.type === ACTION_TYPES.APP_OPEN);
    if (appPat?.data?.app) {
      lines.push(`At this hour, usually opens: ${appPat.data.app}`);
    }
  }

  return lines.length ? `USER HABITS:\n${lines.join('\n')}` : '';
}

// ─── Morning Briefing Builder ─────────────────────────────────────────────────

async function getMorningBriefing(userId) {
  const suggestions = await getSuggestions(userId);
  const daily       = await getDailySummary(userId);

  let briefing = '';
  if (suggestions.length > 0) {
    briefing += `Based on your patterns:\n${suggestions.map(s => `• ${s}`).join('\n')}`;
  }
  if (daily?.total === 0) {
    briefing += briefing ? '\n\nNo activity logged yet today.' : 'No activity logged yet today.';
  }
  return briefing;
}

module.exports = {
  ACTION_TYPES,
  trackAction,
  getHabits,
  getTopApps,
  getTimePatterns,
  getDailySummary,
  getSuggestions,
  getHabitContext,
  getMorningBriefing
};
