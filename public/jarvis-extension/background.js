// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS Chrome Extension — Background Service Worker     ║
// ║  Maintains WebSocket connection to JARVIS server         ║
// ║  Routes commands to the active tab's content script      ║
// ╚══════════════════════════════════════════════════════════╝

const JARVIS_WS = 'ws://localhost:3000/browser-ws';

let ws        = null;
let reconnectTimer = null;
let currentPage    = { url: '', title: '', platform: '' };

// ─── Connect to JARVIS ────────────────────────────────────────────────────────

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(JARVIS_WS);

  ws.onopen = () => {
    console.log('[JARVIS] Connected to server');
    clearTimeout(reconnectTimer);
    // Send current page info on connect
    sendPageInfo();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'command') handleCommand(msg);
    } catch (e) {
      console.error('[JARVIS] Bad message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[JARVIS] Disconnected — retrying in 3s');
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// ─── Send to JARVIS ───────────────────────────────────────────────────────────

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─── Detect Platform from URL ─────────────────────────────────────────────────

function detectPlatform(url) {
  if (!url) return 'unknown';
  if (url.includes('youtube.com'))  return 'youtube';
  if (url.includes('google.com'))   return 'google';
  if (url.includes('github.com'))   return 'github';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('linkedin.com')) return 'linkedin';
  if (url.includes('gmail.com') || url.includes('mail.google.com')) return 'gmail';
  if (url.includes('reddit.com'))   return 'reddit';
  return 'web';
}

// ─── Send Current Page Info ───────────────────────────────────────────────────

async function sendPageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentPage = {
      url:      tab.url      || '',
      title:    tab.title    || '',
      platform: detectPlatform(tab.url),
      tabId:    tab.id
    };

    send({ type: 'page_info', ...currentPage });
  } catch (e) {
    console.error('[JARVIS] sendPageInfo error:', e);
  }
}

// ─── Route Command to Content Script ─────────────────────────────────────────

async function handleCommand(msg) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      send({ type: 'command_result', commandId: msg.commandId, success: false, error: 'No active tab' });
      return;
    }

    // Navigate command — handled in background
    if (msg.action === 'navigate') {
      await chrome.tabs.update(tab.id, { url: msg.data.url });
      send({ type: 'command_result', commandId: msg.commandId, success: true, data: { navigated: msg.data.url } });
      return;
    }
    if (msg.action === 'go_back') {
      await chrome.tabs.goBack(tab.id);
      send({ type: 'command_result', commandId: msg.commandId, success: true });
      return;
    }
    if (msg.action === 'go_forward') {
      await chrome.tabs.goForward(tab.id);
      send({ type: 'command_result', commandId: msg.commandId, success: true });
      return;
    }
    if (msg.action === 'reload') {
      await chrome.tabs.reload(tab.id);
      send({ type: 'command_result', commandId: msg.commandId, success: true });
      return;
    }
    if (msg.action === 'new_tab') {
      await chrome.tabs.create({ url: msg.data?.url || 'chrome://newtab' });
      send({ type: 'command_result', commandId: msg.commandId, success: true });
      return;
    }
    if (msg.action === 'close_tab') {
      await chrome.tabs.remove(tab.id);
      send({ type: 'command_result', commandId: msg.commandId, success: true });
      return;
    }
    if (msg.action === 'get_page_info') {
      await sendPageInfo();
      send({ type: 'command_result', commandId: msg.commandId, success: true, data: currentPage });
      return;
    }

    // ── Play Specific Video: search + auto-click first result ────────────
    if (msg.action === 'yt_play_video') {
      const query = msg.data.query || '';

      // ── FIRST: check if a video is already paused on this page ──────────
      // If yes, just resume it — don't search for a new one
      if (tab.url && tab.url.includes('youtube.com/watch')) {
        try {
          const checkRes = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const v = document.querySelector('video');
              return v ? { hasPausedVideo: v.paused, title: document.title } : null;
            }
          });
          const state = checkRes?.[0]?.result;
          if (state?.hasPausedVideo) {
            // Resume the paused video instead of searching
            await chrome.tabs.sendMessage(tab.id, { type: 'run_command', action: 'yt_play', data: {} }).catch(() => {});
            send({ type: 'command_result', commandId: msg.commandId, success: true, data: { resumed: true, title: state.title } });
            return;
          }
        } catch (_) {}
      }

      // ── Helper: wait for an element to appear in the tab, then click it ──
      async function waitAndClick(tabId, timeoutMs = 8000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          await new Promise(r => setTimeout(r, 600));
          try {
            const res = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => {
                // YouTube uses different renderers in different layouts
                // Priority order: search results → home grid → any link with an ID
                const SELECTORS = [
                  // Search results page
                  'ytd-video-renderer #video-title',
                  'ytd-video-renderer a#thumbnail',
                  // Home / recommendations page
                  'ytd-rich-item-renderer #video-title-link',
                  'ytd-rich-item-renderer a#thumbnail',
                  // Fallback
                  'ytd-compact-video-renderer #video-title',
                  'a#video-title[href*="watch"]',
                  'a[href*="watch?v="]',
                ];
                for (const sel of SELECTORS) {
                  const el = document.querySelector(sel);
                  if (el && el.offsetParent !== null) { // visible check
                    el.scrollIntoView({ block: 'center' });
                    el.click();
                    return { clicked: el.textContent?.trim() || el.getAttribute('title') || '(video)' };
                  }
                }
                return null; // not ready yet
              }
            });
            const result = res?.[0]?.result;
            if (result?.clicked) return result; // success
          } catch (_) { /* page still loading */ }
        }
        return { error: 'Timed out waiting for video results' };
      }

      // Strategy A — already on YouTube: use the search box directly on the page
      if (tab.url && tab.url.includes('youtube.com')) {
        try {
          // Type the query into YouTube's search box and submit
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (q) => {
              const box = document.querySelector('input#search, input[name="search_query"]');
              if (box) {
                box.focus();
                // Native input setter to bypass React's synthetic events
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeSetter.call(box, q);
                box.dispatchEvent(new Event('input', { bubbles: true }));
                box.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
                box.form?.submit();
                const btn = document.querySelector('button#search-icon-legacy, button[aria-label="Search"]');
                if (btn) btn.click();
                return { submitted: true };
              }
              return { error: 'search box not found' };
            },
            args: [query]
          });
        } catch (_) {}

        // Wait for search results to render, then click first video
        await new Promise(r => setTimeout(r, 500));
        // Listen for tab navigation complete
        await new Promise((resolve) => {
          const listener = (tabId, info) => {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          // Fallback resolve after 4s in case page doesn't trigger complete
          setTimeout(resolve, 4000);
        });
      } else {
        // Strategy B — not on YouTube: navigate to search URL directly
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        await chrome.tabs.update(tab.id, { url: searchUrl });
        await new Promise((resolve) => {
          const listener = (tabId, info) => {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(resolve, 6000); // fallback
        });
      }

      // Now click the first video (with retry loop)
      const clickResult = await waitAndClick(tab.id, 8000);
      send({ type: 'command_result', commandId: msg.commandId, success: true, data: { query, ...clickResult } });
      return;
    }

    // All other commands → send to content script via message (works on SPA pages)
    // Content script handles all YouTube + general commands
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type:   'run_command',
        action: msg.action,
        data:   msg.data || {}
      });
      send({ type: 'command_result', commandId: msg.commandId, success: result?.success ?? true, data: result?.data });
    } catch (_) {
      // Fallback: use executeScript injection (for pages where content script isn't loaded yet)
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func:   executeContentCommand,
        args:   [msg.action, msg.data || {}]
      });
      const value = res?.[0]?.result;
      send({ type: 'command_result', commandId: msg.commandId, success: true, data: value });
    }
  } catch (err) {
    send({ type: 'command_result', commandId: msg.commandId, success: false, error: err.message });
  }
}

// ─── Content Script Executor (injected into page) ────────────────────────────
// This function runs INSIDE the page context

function executeContentCommand(action, data) {

  // ── YouTube Controls ────────────────────────────────────────────────────
  const isYouTube = location.hostname.includes('youtube.com');

  function ytVideo() { return document.querySelector('video'); }
  function ytClick(sel) {
    const el = document.querySelector(sel);
    if (el) { el.click(); return true; }
    return false;
  }

  if (isYouTube) {
    switch (action) {
      case 'yt_play':
      case 'yt_resume': {
        const v = ytVideo();
        if (v && v.paused) v.play();
        return { playing: true };
      }
      case 'yt_pause': {
        const v = ytVideo();
        if (v && !v.paused) v.pause();
        return { paused: true };
      }
      case 'yt_toggle': {
        const v = ytVideo();
        if (v) { v.paused ? v.play() : v.pause(); }
        return { paused: v?.paused };
      }
      case 'yt_next':
        ytClick('.ytp-next-button');
        return { action: 'next' };
      case 'yt_mute': {
        const v = ytVideo();
        if (v) v.muted = true;
        return { muted: true };
      }
      case 'yt_unmute': {
        const v = ytVideo();
        if (v) v.muted = false;
        return { muted: false };
      }
      case 'yt_fullscreen':
        ytClick('.ytp-fullscreen-button');
        return { fullscreen: true };
      case 'yt_volume': {
        const v = ytVideo();
        if (v) v.volume = Math.max(0, Math.min(1, (data.value ?? 100) / 100));
        return { volume: v?.volume };
      }
      case 'yt_volume_up': {
        const v = ytVideo();
        if (v) v.volume = Math.min(1, v.volume + 0.1);
        return { volume: Math.round((v?.volume || 0) * 100) };
      }
      case 'yt_volume_down': {
        const v = ytVideo();
        if (v) v.volume = Math.max(0, v.volume - 0.1);
        return { volume: Math.round((v?.volume || 0) * 100) };
      }
      case 'yt_seek': {
        const v = ytVideo();
        if (v) v.currentTime = Math.max(0, v.currentTime + (data.seconds || 0));
        return { currentTime: v?.currentTime };
      }
      case 'yt_speed': {
        const v = ytVideo();
        if (v) v.playbackRate = data.rate || 1;
        return { speed: v?.playbackRate };
      }
      case 'yt_search': {
        const box = document.querySelector('input#search');
        if (box) {
          box.value = data.query || '';
          box.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = document.querySelector('button#search-icon-legacy');
          if (btn) btn.click();
          return { searched: data.query };
        }
        return { error: 'search box not found' };
      }
      case 'yt_like':
        ytClick('like-button-view-model button, #top-level-buttons-computed ytd-toggle-button-renderer:first-child button');
        return { liked: true };

      case 'yt_dislike':
        ytClick('#top-level-buttons-computed ytd-toggle-button-renderer:last-child button');
        return { disliked: true };

      case 'yt_subscribe':
        ytClick('ytd-subscribe-button-renderer button, yt-button-shape button[aria-label*="Subscribe"]');
        return { subscribed: true };

      case 'yt_skip_ad': {
        const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button');
        if (skipBtn) { skipBtn.click(); return { skipped: true }; }
        // If unskippable, mute and speed through it
        const v = ytVideo();
        if (v) { v.muted = true; v.playbackRate = 16; }
        return { muted_ad: true };
      }

      case 'yt_theater':
        ytClick('.ytp-size-button');
        return { theater: true };

      case 'yt_miniplayer':
        ytClick('.ytp-miniplayer-button');
        return { miniplayer: true };

      case 'yt_captions':
        ytClick('.ytp-subtitles-button');
        return { captions: true };

      case 'yt_save': {
        // Click the save / add to playlist button
        ytClick('#top-level-buttons-computed ytd-button-renderer:nth-child(3) button, button[aria-label="Save"]');
        return { saved: true };
      }

      case 'yt_share': {
        ytClick('button[aria-label="Share"], #top-level-buttons-computed yt-button-view-model:last-child button');
        return { share_opened: true };
      }

      case 'yt_channel': {
        const chan = document.querySelector('ytd-channel-name a, #top-row .ytd-channel-name a');
        if (chan) { chan.click(); return { channel: chan.textContent.trim() }; }
        return { error: 'Channel link not found' };
      }

      case 'yt_autoplay': {
        const ap = document.querySelector('.ytp-autonav-toggle-button, button.ytp-button[data-tooltip-target-id="ytp-autonav-toggle-button"]');
        if (ap) { ap.click(); return { toggled: true }; }
        return { error: 'Autoplay button not found' };
      }

      case 'yt_info': {
        const v = ytVideo();
        const title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title')?.textContent?.trim();
        return {
          title:       title || document.title,
          currentTime: v?.currentTime,
          duration:    v?.duration,
          paused:      v?.paused,
          volume:      v?.volume,
          muted:       v?.muted,
          speed:       v?.playbackRate
        };
      }
    }
  }

  // ── General Page Controls ───────────────────────────────────────────────

  switch (action) {
    case 'scroll_down':
      window.scrollBy({ top: data.amount || 400, behavior: 'smooth' });
      return { scrolled: 'down' };

    case 'scroll_up':
      window.scrollBy({ top: -(data.amount || 400), behavior: 'smooth' });
      return { scrolled: 'up' };

    case 'scroll_top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return { scrolled: 'top' };

    case 'scroll_bottom':
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      return { scrolled: 'bottom' };

    case 'click_text': {
      // Click element containing specific text
      const text = (data.text || '').toLowerCase();
      const all  = document.querySelectorAll('a, button, [role=button], input[type=submit]');
      for (const el of all) {
        if (el.textContent.toLowerCase().includes(text)) {
          el.click();
          return { clicked: el.textContent.trim() };
        }
      }
      return { error: `No element with text "${data.text}" found` };
    }

    case 'type_in': {
      const field = document.querySelector(data.selector || 'input:not([type=hidden]):not([type=submit]), textarea');
      if (field) {
        field.focus();
        field.value = data.text || '';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return { typed: data.text };
      }
      return { error: 'No input field found' };
    }

    case 'press_enter': {
      const active = document.activeElement;
      if (active) {
        active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        active.dispatchEvent(new KeyboardEvent('keyup',  { key: 'Enter', bubbles: true }));
      }
      return { pressed: 'Enter' };
    }

    case 'get_text':
      return { text: document.body.innerText.slice(0, 3000) };

    case 'get_links': {
      const links = Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 20)
        .map(a => ({ text: a.textContent.trim(), href: a.href }));
      return { links };
    }

    case 'get_page_info':
      return { url: location.href, title: document.title };

    case 'zoom_in':
      document.body.style.zoom = String((parseFloat(document.body.style.zoom || '1') + 0.1).toFixed(1));
      return { zoom: document.body.style.zoom };

    case 'zoom_out':
      document.body.style.zoom = String(Math.max(0.5, parseFloat(document.body.style.zoom || '1') - 0.1).toFixed(1));
      return { zoom: document.body.style.zoom };

    case 'zoom_reset':
      document.body.style.zoom = '1';
      return { zoom: '1' };

    default:
      return { error: `Unknown action: ${action}` };
  }
}

// ─── Listen for Tab Changes & Content Script Messages ───────────────────────

// Tab switch or full-page reload
chrome.tabs.onActivated.addListener(() => sendPageInfo());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') sendPageInfo();
});

// YouTube SPA navigation — fired by content.js 'yt-navigate-finish' listener
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'page_changed') {
    currentPage = {
      url:      msg.url      || '',
      title:    msg.title    || '',
      platform: detectPlatform(msg.url),
      isWatch:  msg.isWatch  || false,
      isSearch: msg.isSearch || false,
    };
    // Forward to JARVIS server so it knows where you are
    send({ type: 'page_info', ...currentPage });
    console.log(`[JARVIS] Page: [${currentPage.platform}] ${currentPage.title}`);
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
connect();
