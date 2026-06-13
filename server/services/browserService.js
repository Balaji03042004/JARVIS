'use strict';

// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS Browser Service                                  ║
// ║  WebSocket hub — communicates with Chrome Extension      ║
// ║  Sends commands, receives page state                     ║
// ╚══════════════════════════════════════════════════════════╝

const { WebSocketServer } = require('ws');
const { v4: uuidv4 }      = require('crypto').randomUUID ? { v4: () => require('crypto').randomUUID() } : require('crypto');
const logger              = require('../utils/logger');

// ─── State ────────────────────────────────────────────────────────────────────
let _wss        = null;
let _client     = null;   // single Chrome extension client
let _pageState  = { url: '', title: '', platform: 'unknown', connected: false };
const _pending  = new Map(); // commandId → { resolve, reject, timer }

// ─── Init WebSocket Server ────────────────────────────────────────────────────
// Attach to existing HTTP server from Express

function initBrowserWS(httpServer) {
  _wss = new WebSocketServer({ server: httpServer, path: '/browser-ws' });

  _wss.on('connection', (ws) => {
    logger.info('Chrome Extension connected');
    _client = ws;
    _pageState.connected = true;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(msg);
      } catch (e) {
        logger.error('Browser WS parse error: ' + e.message);
      }
    });

    ws.on('close', () => {
      logger.info('Chrome Extension disconnected');
      _client = null;
      _pageState.connected = false;
    });

    ws.on('error', (err) => {
      logger.error('Browser WS error: ' + err.message);
    });
  });

  logger.info('Browser WebSocket ready at ws://localhost/browser-ws');
}

// ─── Handle Incoming Messages from Extension ──────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case 'page_info':
      _pageState = {
        url:       msg.url      || '',
        title:     msg.title    || '',
        platform:  msg.platform || 'web',
        connected: true
      };
      logger.info(`Browser: [${_pageState.platform}] ${_pageState.title}`);
      break;

    case 'command_result': {
      const prom = _pending.get(msg.commandId);
      if (prom) {
        clearTimeout(prom.timer);
        _pending.delete(msg.commandId);
        if (msg.success) prom.resolve(msg.data);
        else             prom.reject(new Error(msg.error || 'Command failed'));
      }
      break;
    }

    default:
      break;
  }
}

// ─── Send Command to Extension ────────────────────────────────────────────────
// Returns a promise that resolves with the result or rejects on timeout

function sendCommand(action, data = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!_client || _client.readyState !== 1 /* OPEN */) {
      return reject(new Error('Chrome Extension not connected. Install the JARVIS extension in Chrome.'));
    }

    const commandId = require('crypto').randomUUID();
    const timer = setTimeout(() => {
      _pending.delete(commandId);
      reject(new Error(`Command "${action}" timed out`));
    }, timeoutMs);

    _pending.set(commandId, { resolve, reject, timer });
    _client.send(JSON.stringify({ type: 'command', commandId, action, data }));
  });
}

// ─── Convenience Getters ──────────────────────────────────────────────────────

function getPageState()     { return { ..._pageState }; }
function isConnected()      { return _client !== null && _client.readyState === 1; }
function getCurrentPlatform() { return _pageState.platform; }

// ─── Parse Browser Intent from Chat Message ───────────────────────────────────

const BROWSER_INTENTS = [
  // Page info
  { re: /\b(where am i|what (page|site|website)|what (am i|are you) (looking at|on)|current (page|tab|url|site))\b/i, action: 'get_page_info' },

  // Navigation
  { re: /\b(go to|open|navigate to|visit)\s+(https?:\/\/\S+|[\w.-]+\.(com|org|net|io|dev|in|co)[\S]*)/i, action: 'navigate', capture: 1 },
  { re: /\b(go back|browser back|previous page)\b/i,    action: 'go_back'    },
  { re: /\b(go forward|browser forward|next page)\b/i,  action: 'go_forward' },
  { re: /\b(reload|refresh)\s*(page|tab|this)?\b/i,     action: 'reload'     },
  { re: /\b(new tab|open new tab)\b/i,                   action: 'new_tab'   },
  { re: /\b(close tab|close this tab)\b/i,               action: 'close_tab' },

  // Scroll
  { re: /\b(scroll down|page down)\b/i,    action: 'scroll_down'   },
  { re: /\b(scroll up|page up)\b/i,        action: 'scroll_up'     },
  { re: /\b(scroll to top|go to top)\b/i,  action: 'scroll_top'    },
  { re: /\b(scroll to bottom|go to bottom)\b/i, action: 'scroll_bottom' },

  // Zoom
  { re: /\bzoom in\b/i,    action: 'zoom_in'    },
  { re: /\bzoom out\b/i,   action: 'zoom_out'   },
  { re: /\bzoom reset\b/i, action: 'zoom_reset' },

  // Click / type
  { re: /\bclick\s+(?:on\s+)?(?:the\s+)?["']?([^"']+?)["']?\s*(?:button|link|tab|text)?\s*$/i, action: 'click_text', capture: 0 },
  { re: /\btype\s+"([^"]+)"\s+(?:in|into|on)\b/i, action: 'type_in', capture: 0 },

  // YouTube ──────────────────────────────────────────────────────────────────────

  // ── RESUME current paused video (MUST be checked FIRST) ────────────────
  // Matches: "play", "resume", "play it", "play now", "play again",
  // "play the video", "resume the video", "continue", "unpause"
  { re: /^\s*(play|resume|unpause|continue)\s*$/i,                              action: 'yt_play' },
  { re: /\b(play|resume)\s+(it|this|that|the video|the music|again|now|back)\b/i, action: 'yt_play' },
  { re: /\b(play|resume)\s+(the\s+)?(video|youtube|yt|music|song|audio)\b/i,  action: 'yt_play' },
  { re: /\bplay\s*$|^\s*play\s*$/i,                                            action: 'yt_play' },

  // ── Play SPECIFIC video by title (search + auto-click first result) ─────
  // Only triggers when user says "play [real video title]"
  // Requires: at least 2 words OR one word that’s clearly a name/title
  // EXCLUDED: it, this, that, the, now, again, back, next, music, video, song
  { re: /\bplay\s+((?!(?:it|this|that|the|now|again|back|next|music|video|song|audio|yt|youtube)\b)[\w][\w\s]{3,80}?)(?:\s+on\s+(?:youtube|yt))?\s*$/i, action: 'yt_play_video' },
  { re: /\bpause\s+(the\s+)?(video|youtube|yt)?\b/i,          action: 'yt_pause'     },
  { re: /\bpause\b/i,                                          action: 'yt_pause'     },
  { re: /\b(next video|skip video)\b/i,                        action: 'yt_next'      },
  { re: /\b(mute|silence)\s*(the video|youtube|yt)?\b/i,      action: 'yt_mute'      },
  { re: /\bunmute\b/i,                                         action: 'yt_unmute'    },
  { re: /\b(full ?screen|maximize video)\b/i,                  action: 'yt_fullscreen'},
  { re: /\bvolume up\b/i,                                      action: 'yt_volume_up' },
  { re: /\bvolume down\b/i,                                    action: 'yt_volume_down'},
  { re: /\bset volume\s+(?:to\s+)?(\d+)\b/i,                  action: 'yt_volume'    },
  { re: /\bskip\s+(?:forward\s+)?(\d+)\s*(?:sec|second)s?\b/i, action: 'yt_seek_fwd' },
  { re: /\bskip\s+back(?:ward)?\s+(\d+)\s*(?:sec|second)s?\b/i, action: 'yt_seek_back'},
  { re: /\b(?:set\s+)?(?:playback\s+)?speed\s+(?:to\s+)?(\d+(?:\.\d+)?)[x×]?\b/i, action: 'yt_speed' },
  { re: /\blike\s+(the\s+)?video\b/i,                          action: 'yt_like'      },
  { re: /\bdislike\s+(the\s+)?video\b/i,                       action: 'yt_dislike'   },
  { re: /\bsubscribe\b/i,                                       action: 'yt_subscribe' },
  { re: /\b(skip|close|dismiss)\s+(the\s+)?ad\b/i,            action: 'yt_skip_ad'   },
  { re: /\btheater\s+mode\b/i,                                  action: 'yt_theater'   },
  { re: /\bmini\s*player\b/i,                                   action: 'yt_miniplayer'},
  { re: /\b(captions?|subtitles?)\b/i,                         action: 'yt_captions'  },
  { re: /\bsave\s+(to\s+)?(playlist|watch later)\b/i,         action: 'yt_save'      },
  { re: /\btoggle\s+autoplay\b/i,                               action: 'yt_autoplay'  },
  { re: /\bopen\s+(the\s+)?channel\b/i,                        action: 'yt_channel'   },
  { re: /\byt info\b|\bvideo info\b|\bwhat('s| is) (playing|this video)\b/i, action: 'yt_info' },
  { re: /\bsearch\s+(?:youtube|yt)\s+for\s+(.+)/i,            action: 'yt_search'    },
];

function parseBrowserIntent(message) {
  const msg = String(message || '');

  for (const intent of BROWSER_INTENTS) {
    const m = msg.match(intent.re);
    if (!m) continue;

    const data = {};

    // Navigation URL
    if (intent.action === 'navigate') {
      let url = m[2] || m[1] || '';
      if (!url.startsWith('http')) url = 'https://' + url;
      data.url = url;
    }

    // Play specific video — extract query from capture group
    if (intent.action === 'yt_play_video') {
      data.query = (m[1] || '').trim();
      if (!data.query) continue; // skip if no actual query
      return { action: 'yt_play_video', data };
    }

    // YouTube search
    if (intent.action === 'yt_search') {
      data.query = (m[1] || m[intent.capture + 1] || '').trim();
    }

    // Volume
    if (intent.action === 'yt_volume') {
      data.value = parseInt(m[1] || '50', 10);
    }

    // Speed
    if (intent.action === 'yt_speed') {
      data.rate = parseFloat(m[1] || '1');
    }

    // Seek forward
    if (intent.action === 'yt_seek_fwd') {
      return { action: 'yt_seek', data: { seconds: parseInt(m[1] || '10', 10) } };
    }

    // Seek back
    if (intent.action === 'yt_seek_back') {
      return { action: 'yt_seek', data: { seconds: -(parseInt(m[1] || '10', 10)) } };
    }

    // Click text
    if (intent.action === 'click_text') {
      data.text = (m[1] || '').trim();
    }

    // Type in
    if (intent.action === 'type_in') {
      data.text = (m[1] || '').trim();
    }

    return { action: intent.action, data };
  }

  return null;
}

module.exports = {
  initBrowserWS,
  sendCommand,
  getPageState,
  isConnected,
  getCurrentPlatform,
  parseBrowserIntent,
};
