'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — Intent Chain Parser
// Splits compound commands into sequential intents
// "open youtube and play lofi then pause" → ["open youtube", "play lofi", "pause"]
// ═══════════════════════════════════════════════════════════════════════════════

const phoneService   = require('./phoneService');
const cameraService  = require('./cameraService');
const browserService = require('./browserService');
const systemService  = require('./systemService');

// ─── Split on chain connectors ────────────────────────────────────────────────
const CHAIN_SPLIT_RE = /\s+(?:and\s+then|then|after\s+that|next,?\s+|also,?\s+|,\s*and\s+|;\s*|,\s+then\s+)\s+/i;

// Minimum meaningful segment length (filters noise like "and", "ok", etc.)
const MIN_SEG_LEN = 4;

/**
 * Parse a message into an array of sequential intent segments.
 * Returns [] if the message is a single intent (no chain detected).
 *
 * @param {string} message
 * @returns {string[]}
 */
function parseChain(message) {
  const msg = String(message || '').trim();
  if (!msg) return [];

  const parts = msg
    .split(CHAIN_SPLIT_RE)
    .map(s => s.trim())
    .filter(s => s.length >= MIN_SEG_LEN);

  // Only treat as a chain if we get 2+ distinct segments
  return parts.length >= 2 ? parts : [];
}

/**
 * Execute a single intent segment and return a human-readable result string.
 * Mirrors the logic in chatController but returns text instead of HTTP responses.
 *
 * @param {string} segment      — one piece of a chained command
 * @param {string} userId
 * @returns {Promise<string>}   — result text
 */
async function executeSegment(segment, userId) {
  const msg = segment.trim();

  // ── Phone intent ────────────────────────────────────────────────────────
  const callIntent = phoneService.parseCallIntent(msg);
  if (callIntent) {
    if (callIntent.action === 'end_call') {
      const r = await phoneService.endCall();
      return r.success ? 'Call ended.' : `Couldn't end call: ${r.message}`;
    }
    if (callIntent.action === 'call') {
      const contact = await phoneService.findContactByName(userId, callIntent.name);
      if (contact) {
        const r = await phoneService.makeCall(contact.phone);
        return r.success ? `Calling ${contact.name}.` : `Call failed: ${r.message}`;
      }
      return `No contact named "${callIntent.name}" found.`;
    }
  }

  // ── Camera intent ────────────────────────────────────────────────────────
  const camIntent = cameraService.parseCameraIntent(msg);
  if (camIntent) {
    switch (camIntent.action) {
      case 'open_app': {
        const r = await cameraService.openCameraApp();
        return r.success ? 'Camera app opened.' : `Camera failed: ${r.message}`;
      }
      case 'capture': {
        const r = await cameraService.captureImage();
        return r.success ? `Photo captured: http://localhost:3000${r.url}` : `Capture failed: ${r.message}`;
      }
      case 'start_recording': {
        const r = await cameraService.startRecording(camIntent.duration || 0);
        return r.success ? r.message : `Recording failed: ${r.message}`;
      }
      case 'stop_recording': {
        const r = await cameraService.stopRecording();
        return r.success ? r.message : r.message;
      }
      default: return 'Camera command done.';
    }
  }

  // ── Browser intent ───────────────────────────────────────────────────────
  const brIntent = browserService.parseBrowserIntent(msg);
  if (brIntent) {
    if (!browserService.isConnected()) return 'Browser extension not connected.';
    try {
      const result = await browserService.sendCommand(brIntent.action, brIntent.data || {});
      if (brIntent.action === 'yt_play_video') {
        return result?.resumed
          ? `Resumed "${result.title || 'video'}".`
          : `Searching and playing "${brIntent.data.query}" on YouTube.`;
      }
      if (brIntent.action === 'yt_play' || brIntent.action === 'yt_resume') {
        return result?.title ? `Playing "${result.title}".` : 'Playing video.';
      }
      if (brIntent.action === 'yt_pause') return 'Video paused.';
      if (brIntent.action === 'navigate') return `Navigated to ${brIntent.data.url}.`;
      return 'Browser command done.';
    } catch (e) {
      return `Browser command failed: ${e.message}`;
    }
  }

  // ── System / app open ─────────────────────────────────────────────────────
  const openMatch = msg.match(/^(?:open|launch|start|run|execute)\s+(.+)/i);
  if (openMatch) {
    try {
      const r = await systemService.openAnyAppTarget(openMatch[1].trim());
      return r.success ? `Opened ${r.opened || openMatch[1]}.` : `Couldn't open: ${r.message}`;
    } catch (e) {
      return `Launch failed: ${e.message}`;
    }
  }

  // ── Close / kill ──────────────────────────────────────────────────────────
  const closeMatch = msg.match(/^(?:close|quit|exit|kill)\s+(.+)/i);
  if (closeMatch) {
    try {
      const r = await systemService.closeApp(closeMatch[1].trim());
      return r.success ? `Closed ${closeMatch[1]}.` : `Couldn't close: ${r.message}`;
    } catch (e) {
      return `Close failed: ${e.message}`;
    }
  }

  // ── Spotify shortcuts ─────────────────────────────────────────────────────
  const spotifyService = safeRequire('./spotifyService');
  if (spotifyService) {
    const spIntent = spotifyService.parseSpotifyIntent(msg);
    if (spIntent) {
      const result = await spotifyService.handleIntent(spIntent);
      return result.reply || 'Spotify command done.';
    }
  }

  // ── GitHub shortcuts ──────────────────────────────────────────────────────
  const githubService = safeRequire('./githubService');
  if (githubService) {
    const ghIntent = githubService.parseGitHubIntent(msg);
    if (ghIntent) {
      const result = await githubService.handleIntent(ghIntent);
      return result.reply || 'GitHub command done.';
    }
  }

  // ── Fallback — return the segment as-is for AI to handle ─────────────────
  return `__AI__:${msg}`;
}

/**
 * Execute all segments of a chain and collect results.
 * Segments marked __AI__: are collected for a single AI call at the end.
 *
 * @param {string[]} segments
 * @param {string}   userId
 * @returns {Promise<{results: string[], hasAI: boolean, aiParts: string[]}>}
 */
async function executeChain(segments, userId) {
  const results = [];
  const aiParts = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Small delay between actions to avoid race conditions
    if (i > 0) await new Promise(r => setTimeout(r, 600));

    const out = await executeSegment(seg, userId);
    if (out.startsWith('__AI__:')) {
      aiParts.push(out.slice(7));
    } else {
      results.push(out);
    }
  }

  return { results, hasAI: aiParts.length > 0, aiParts };
}

// ─── Safe require helper ──────────────────────────────────────────────────────
function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

module.exports = { parseChain, executeChain, executeSegment };
