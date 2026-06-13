// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — Content Script                                 ║
// ║  Detects YouTube SPA navigation + executes commands      ║
// ╚══════════════════════════════════════════════════════════╝

(function () {
  if (window.__jarvisContentLoaded) return;
  window.__jarvisContentLoaded = true;

  // ─── Notify background of page state ─────────────────────────────────────
  function notifyPageChange() {
    chrome.runtime.sendMessage({
      type:     'page_changed',
      url:      location.href,
      title:    document.title,
      isWatch:  location.pathname.startsWith('/watch'),
      isSearch: location.pathname.startsWith('/results'),
    }).catch(() => {});
  }

  notifyPageChange(); // fire immediately on load

  // ─── YouTube SPA Navigation Detection ────────────────────────────────────
  // YouTube never fully reloads — it uses history.pushState.
  // 'yt-navigate-finish' fires after every YouTube internal navigation.
  if (location.hostname.includes('youtube.com')) {

    // Primary method: YouTube's own event
    document.addEventListener('yt-navigate-finish', () => {
      setTimeout(notifyPageChange, 600);
    });

    // Fallback: intercept pushState
    const _push = history.pushState.bind(history);
    history.pushState = function (...args) {
      _push(...args);
      setTimeout(notifyPageChange, 600);
    };

    // Back / forward
    window.addEventListener('popstate', () => setTimeout(notifyPageChange, 600));
  }

  // ─── Receive commands from background ────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'run_command') return;
    try {
      const result = executeCommand(msg.action, msg.data || {});
      sendResponse({ success: true, data: result });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true; // keep channel open
  });

  // ─── Command Executor ─────────────────────────────────────────────────────
  function executeCommand(action, data) {
    const isYT = location.hostname.includes('youtube.com');

    function video()      { return document.querySelector('video'); }
    function ytClick(sel) { const el = document.querySelector(sel); if (el) { el.click(); return true; } return false; }

    if (isYT) {
      switch (action) {
        case 'yt_play': {
          const v = video();
          if (v) {
            v.play();
            return { playing: true, title: document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || document.title };
          }
          return { error: 'No video found on this page' };
        }
        case 'yt_pause': {
          const v = video();
          if (v && !v.paused) {
            v.pause();
            return { paused: true, title: document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || document.title };
          }
          return { already_paused: true };
        }
        case 'yt_toggle':     { const v = video(); if (v) { v.paused ? v.play() : v.pause(); } return { paused: !!video()?.paused }; }
        case 'yt_next':        ytClick('.ytp-next-button'); return { action: 'next' };
        case 'yt_mute':       { const v = video(); if (v) v.muted = true;  return { muted: true };  }
        case 'yt_unmute':     { const v = video(); if (v) v.muted = false; return { muted: false }; }
        case 'yt_fullscreen':  ytClick('.ytp-fullscreen-button');     return { fullscreen: true };
        case 'yt_theater':     ytClick('.ytp-size-button');            return { theater: true };
        case 'yt_miniplayer':  ytClick('.ytp-miniplayer-button');      return { miniplayer: true };
        case 'yt_captions':    ytClick('.ytp-subtitles-button');       return { captions: true };
        case 'yt_autoplay':    ytClick('.ytp-autonav-toggle-button'); return { autoplay: 'toggled' };
        case 'yt_like':        ytClick('like-button-view-model button, #top-level-buttons-computed ytd-toggle-button-renderer:first-child button'); return { liked: true };
        case 'yt_dislike':     ytClick('#top-level-buttons-computed ytd-toggle-button-renderer:last-child button'); return { disliked: true };
        case 'yt_subscribe':   ytClick('ytd-subscribe-button-renderer button, yt-button-shape button[aria-label*="Subscribe"]'); return { subscribed: true };
        case 'yt_channel':   { const a = document.querySelector('ytd-channel-name a'); if (a) a.click(); return { channel: a?.textContent?.trim() }; }
        case 'yt_skip_ad': {
          const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button');
          if (skip) { skip.click(); return { skipped: true }; }
          const v = video(); if (v) { v.muted = true; v.playbackRate = 16; }
          return { muted_ad: true };
        }
        case 'yt_volume_up':   { const v = video(); if (v) v.volume = Math.min(1, v.volume + 0.1); return { volume: Math.round((v?.volume||0)*100) }; }
        case 'yt_volume_down': { const v = video(); if (v) v.volume = Math.max(0, v.volume - 0.1); return { volume: Math.round((v?.volume||0)*100) }; }
        case 'yt_volume':      { const v = video(); if (v) v.volume = Math.max(0, Math.min(1, (data.value??100)/100)); return { volume: Math.round((v?.volume||0)*100) }; }
        case 'yt_seek':        { const v = video(); if (v) v.currentTime = Math.max(0, v.currentTime + (data.seconds||0)); return { currentTime: Math.floor(v?.currentTime||0) }; }
        case 'yt_speed':       { const v = video(); if (v) v.playbackRate = data.rate || 1; return { speed: v?.playbackRate }; }
        case 'yt_info': {
          const v = video();
          const t = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string')?.textContent?.trim();
          const fmt = n => `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
          return { title: t||document.title, currentTime: fmt(v?.currentTime||0), duration: fmt(v?.duration||0), paused: v?.paused, volume: Math.round((v?.volume||0)*100), muted: v?.muted, speed: v?.playbackRate };
        }
        case 'yt_search': {
          const box = document.querySelector('input#search, input[name="search_query"]');
          if (!box) return { error: 'Search box not found' };
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(box, data.query || '');
          box.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = document.querySelector('button#search-icon-legacy, button[aria-label="Search"]');
          if (btn) btn.click(); else box.form?.submit();
          return { searched: data.query };
        }
      }
    }

    // ── General page commands ───────────────────────────────────────────────
    switch (action) {
      case 'scroll_down':   window.scrollBy({ top:  data.amount||400, behavior:'smooth' }); return { scrolled: 'down' };
      case 'scroll_up':     window.scrollBy({ top: -(data.amount||400), behavior:'smooth' }); return { scrolled: 'up' };
      case 'scroll_top':    window.scrollTo({ top: 0, behavior:'smooth' }); return { scrolled: 'top' };
      case 'scroll_bottom': window.scrollTo({ top: document.body.scrollHeight, behavior:'smooth' }); return { scrolled: 'bottom' };
      case 'zoom_in':       document.body.style.zoom = String((parseFloat(document.body.style.zoom||'1')+0.1).toFixed(1)); return { zoom: document.body.style.zoom };
      case 'zoom_out':      document.body.style.zoom = String(Math.max(0.5,parseFloat(document.body.style.zoom||'1')-0.1).toFixed(1)); return { zoom: document.body.style.zoom };
      case 'zoom_reset':    document.body.style.zoom = '1'; return { zoom: '1' };
      case 'click_text': {
        const q = (data.text||'').toLowerCase();
        for (const el of document.querySelectorAll('a,button,[role=button],input[type=submit]')) {
          if (el.textContent.toLowerCase().includes(q)) { el.click(); return { clicked: el.textContent.trim() }; }
        }
        return { error: `No element with text "${data.text}"` };
      }
      case 'get_page_info': return { url: location.href, title: document.title };
      case 'get_text':      return { text: document.body.innerText.slice(0, 3000) };
      default: return { error: `Unknown action: ${action}` };
    }
  }

})();
