'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — Spotify Integration Service
// Uses Spotify Web API (Client Credentials) for search
// Uses Windows URI scheme (spotify:track:ID) for playback launch
// Uses media key simulation for play/pause/skip control
// ═══════════════════════════════════════════════════════════════════════════════

const { exec }     = require('child_process');
const { promisify } = require('util');
const execAsync    = promisify(exec);
const logger       = require('../utils/logger');

// ─── Spotify API Config ───────────────────────────────────────────────────────

const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID     || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_API_BASE      = 'https://api.spotify.com/v1';

let _accessToken    = null;
let _tokenExpiresAt = 0;

// ─── Client Credentials Token ─────────────────────────────────────────────────
// Used for search only (no user data, no playback control via API)

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiresAt - 30000) return _accessToken;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET not set in .env');
  }

  const creds   = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const resp    = await fetch('https://accounts.spotify.com/api/token', {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!resp.ok) throw new Error(`Spotify auth failed: ${resp.status}`);
  const data   = await resp.json();
  _accessToken    = data.access_token;
  _tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  logger.info('Spotify access token refreshed');
  return _accessToken;
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function searchTrack(query) {
  const token = await getAccessToken();
  const url   = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=track&limit=5`;
  const resp  = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Spotify search failed: ${resp.status}`);
  const data  = await resp.json();
  return (data.tracks?.items || []).map(t => ({
    id:       t.id,
    uri:      t.uri,
    name:     t.name,
    artists:  t.artists.map(a => a.name).join(', '),
    album:    t.album.name,
    preview:  t.preview_url,
    duration: Math.round(t.duration_ms / 1000)
  }));
}

async function searchPlaylist(query) {
  const token = await getAccessToken();
  const url   = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=playlist&limit=5`;
  const resp  = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Spotify search failed: ${resp.status}`);
  const data  = await resp.json();
  return (data.playlists?.items || []).map(p => ({
    id:  p.id,
    uri: p.uri,
    name: p.name,
    owner: p.owner?.display_name
  }));
}

async function searchArtist(query) {
  const token = await getAccessToken();
  const url   = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=artist&limit=3`;
  const resp  = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Spotify search failed: ${resp.status}`);
  const data  = await resp.json();
  return (data.artists?.items || []).map(a => ({
    id:     a.id,
    uri:    a.uri,
    name:   a.name,
    genres: a.genres?.slice(0, 3)
  }));
}

// ─── Playback via Windows URI Scheme ─────────────────────────────────────────
// Opens the Spotify desktop app directly to the track/playlist

async function launchSpotifyUri(uri) {
  // uri: spotify:track:ID | spotify:playlist:ID | spotify:artist:ID
  await execAsync(`cmd.exe /c start "" "${uri}"`, { timeout: 5000 });
}

// ─── Media Key Simulation (Windows) ──────────────────────────────────────────
// Controls Spotify/any media app via media keys without OAuth

async function _sendMediaKey(key) {
  // Uses WScript.Shell SendKeys — works on all Windows
  const keyMap = {
    play_pause: '{MEDIA_PLAY_PAUSE}',
    next:       '{MEDIA_NEXT_TRACK}',
    prev:       '{MEDIA_PREV_TRACK}',
    stop:       '{MEDIA_STOP}',
    vol_up:     '{VOLUME_UP}',
    vol_down:   '{VOLUME_DOWN}',
    vol_mute:   '{VOLUME_MUTE}'
  };
  const vk = keyMap[key];
  if (!vk) return;
  // VBScript runner via cscript — works without PowerShell
  const script = `CreateObject("WScript.Shell").SendKeys "${vk}"`;
  await execAsync(`cscript //nologo //e:vbscript /b - <<EOF\n${script}\nEOF`, { timeout: 3000 }).catch(() => {
    // Fallback: direct wsh via temp file
    return execAsync(`cmd.exe /c echo CreateObject("WScript.Shell").SendKeys "${vk}" | cscript //nologo //e:vbscript`, { timeout: 3000 });
  });
}

async function mediaPlay()     { await _sendMediaKey('play_pause'); }
async function mediaPause()    { await _sendMediaKey('play_pause'); }
async function mediaNext()     { await _sendMediaKey('next'); }
async function mediaPrev()     { await _sendMediaKey('prev'); }
async function mediaStop()     { await _sendMediaKey('stop'); }
async function mediaVolUp()    { await _sendMediaKey('vol_up'); }
async function mediaVolDown()  { await _sendMediaKey('vol_down'); }
async function mediaMute()     { await _sendMediaKey('vol_mute'); }

// ─── Play Track / Playlist by Name ───────────────────────────────────────────

async function playTrackByName(query) {
  if (!SPOTIFY_CLIENT_ID) {
    // No Spotify API keys → open Spotify Web in browser via deep link
    const encoded = encodeURIComponent(query);
    await execAsync(`cmd.exe /c start "" "https://open.spotify.com/search/${encoded}"`, { timeout: 5000 });
    return { success: true, method: 'web', query };
  }

  const tracks = await searchTrack(query);
  if (!tracks.length) return { success: false, message: `No track found for "${query}"` };

  const top = tracks[0];
  await launchSpotifyUri(top.uri);
  return { success: true, track: top, method: 'uri' };
}

async function playPlaylistByName(query) {
  if (!SPOTIFY_CLIENT_ID) {
    const encoded = encodeURIComponent(query);
    await execAsync(`cmd.exe /c start "" "https://open.spotify.com/search/${encoded}"`, { timeout: 5000 });
    return { success: true, method: 'web', query };
  }

  const playlists = await searchPlaylist(query);
  if (!playlists.length) return { success: false, message: `No playlist found for "${query}"` };

  const top = playlists[0];
  await launchSpotifyUri(top.uri);
  return { success: true, playlist: top, method: 'uri' };
}

// ─── Intent Parser ────────────────────────────────────────────────────────────

const SPOTIFY_INTENTS = [
  // Open Spotify
  { re: /^(?:open|launch|start)\s+spotify$/i,                action: 'open' },
  // Play specific song
  { re: /^(?:play|put on|start playing)\s+(.+?)\s+(?:on\s+spotify|by\s+.+)?$/i, action: 'play_track', group: 1 },
  // Play playlist
  { re: /^play\s+(?:the\s+)?(.+?)\s+(?:playlist|radio|mix)/i, action: 'play_playlist', group: 1 },
  // Pause / resume
  { re: /^(?:pause|stop)\s+(?:spotify|music|the\s+music|playback)$/i, action: 'pause' },
  { re: /^(?:resume|continue|unpause)\s+(?:spotify|music|the\s+music|playback)?$/i, action: 'resume' },
  // Next / prev
  { re: /^(?:next\s+(?:song|track)|skip\s+(?:song|track)?|skip\s+this)$/i, action: 'next' },
  { re: /^(?:previous\s+(?:song|track)|prev\s+(?:song|track)?|go\s+back\s+(?:a\s+song)?|last\s+song)$/i, action: 'prev' },
  // Volume
  { re: /^(?:volume\s+up|louder|increase\s+volume|turn\s+(?:it\s+)?up)$/i,   action: 'vol_up' },
  { re: /^(?:volume\s+down|quieter|decrease\s+volume|turn\s+(?:it\s+)?down)$/i, action: 'vol_down' },
  { re: /^(?:mute|unmute)\s+(?:spotify|music)?$/i, action: 'mute' },
  // What's playing
  { re: /^(?:what(?:'s|\s+is)\s+(?:playing|this\s+song|the\s+song)|now\s+playing|current\s+song)$/i, action: 'now_playing' },
];

function parseSpotifyIntent(message) {
  const msg = String(message || '').trim();
  for (const intent of SPOTIFY_INTENTS) {
    const m = msg.match(intent.re);
    if (m) {
      return {
        action: intent.action,
        query:  intent.group ? (m[intent.group] || '').trim() : undefined,
        raw:    msg
      };
    }
  }
  return null;
}

// ─── Handle Intent ────────────────────────────────────────────────────────────

async function handleIntent(intent) {
  try {
    switch (intent.action) {
      case 'open': {
        await execAsync('cmd.exe /c start "" "spotify:"', { timeout: 5000 });
        return { success: true, reply: 'Opening Spotify, Boss.' };
      }
      case 'play_track': {
        const r = await playTrackByName(intent.query);
        if (r.success && r.track) {
          return { success: true, reply: `Playing "${r.track.name}" by ${r.track.artists} on Spotify, Boss.` };
        } else if (r.success) {
          return { success: true, reply: `Opening Spotify search for "${intent.query}", Boss.` };
        }
        return { success: false, reply: `${r.message} on Spotify, Boss.` };
      }
      case 'play_playlist': {
        const r = await playPlaylistByName(intent.query);
        if (r.success && r.playlist) {
          return { success: true, reply: `Playing playlist "${r.playlist.name}" on Spotify, Boss.` };
        } else if (r.success) {
          return { success: true, reply: `Opening Spotify playlist search for "${intent.query}", Boss.` };
        }
        return { success: false, reply: `${r.message}, Boss.` };
      }
      case 'pause':    { await mediaPause();   return { success: true, reply: 'Music paused, Boss.' }; }
      case 'resume':   { await mediaPlay();    return { success: true, reply: 'Music resumed, Boss.' }; }
      case 'next':     { await mediaNext();    return { success: true, reply: 'Skipping to next track, Boss.' }; }
      case 'prev':     { await mediaPrev();    return { success: true, reply: 'Going to previous track, Boss.' }; }
      case 'vol_up':   { await mediaVolUp();   return { success: true, reply: 'Volume up, Boss.' }; }
      case 'vol_down': { await mediaVolDown(); return { success: true, reply: 'Volume down, Boss.' }; }
      case 'mute':     { await mediaMute();    return { success: true, reply: 'Audio muted/unmuted, Boss.' }; }
      case 'now_playing': {
        return { success: true, reply: "I can see what's playing if Spotify is open — check the taskbar, Boss. Full playback status requires Spotify OAuth setup." };
      }
      default: return { success: false, reply: 'Unknown Spotify command, Boss.' };
    }
  } catch (err) {
    logger.error('Spotify intent error: ' + err.message);
    return { success: false, reply: `Spotify error: ${err.message}` };
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

function getStatus() {
  return {
    hasKeys:    !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
    tokenReady: !!(SPOTIFY_CLIENT_ID && _accessToken && Date.now() < _tokenExpiresAt),
    tokenExpires: _tokenExpiresAt ? new Date(_tokenExpiresAt).toISOString() : null
  };
}

module.exports = {
  searchTrack, searchPlaylist, searchArtist,
  playTrackByName, playPlaylistByName,
  mediaPlay, mediaPause, mediaNext, mediaPrev, mediaStop,
  mediaVolUp, mediaVolDown, mediaMute,
  parseSpotifyIntent, handleIntent,
  getStatus
};
