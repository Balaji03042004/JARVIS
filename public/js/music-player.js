// ═══════════════════════════════════════════════
// JARVIS — Embedded YouTube Music Player
// ═══════════════════════════════════════════════

let _ytPlayer      = null;
let _ytApiReady    = false;
let _ytPendingId   = null;
let _ytPendingTitle= null;
let _ytPlaylist    = [];
let _ytPlIdx       = 0;

// Inject YouTube IFrame API script
(function () {
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
})();

// Called by YouTube when API is loaded
function onYouTubeIframeAPIReady() {
  _ytApiReady = true;
  if (_ytPendingId) {
    _ytCreatePlayer(_ytPendingId, _ytPendingTitle);
    _ytPendingId = _ytPendingTitle = null;
  }
}

// ── Internal: create or update the embedded player ──────────────────────────
function _ytCreatePlayer(videoId, title) {
  const panel = document.getElementById('jarvisMusicPlayer');
  const nowEl = document.getElementById('musicNowPlaying');
  if (nowEl) nowEl.textContent = title || 'Loading…';
  if (panel) panel.classList.remove('hidden');

  if (_ytPlayer && typeof _ytPlayer.loadVideoById === 'function') {
    // Player already exists — swap video
    _ytPlayer.loadVideoById(videoId);
    const btn = document.getElementById('musicPlayPauseBtn');
    if (btn) btn.textContent = '⏸';
    return;
  }

  // Destroy old placeholder content if any
  const container = document.getElementById('ytPlayerDiv');
  if (container) container.innerHTML = '';

  _ytPlayer = new YT.Player('ytPlayerDiv', {
    height: '180',
    width: '100%',
    videoId: videoId,
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      fs: 0,
      iv_load_policy: 3
    },
    events: {
      onReady: function (e) {
        e.target.playVideo();
        const btn = document.getElementById('musicPlayPauseBtn');
        if (btn) btn.textContent = '⏸';
      },
      onStateChange: function (e) {
        const btn = document.getElementById('musicPlayPauseBtn');
        if (e.data === YT.PlayerState.PLAYING) {
          if (btn) btn.textContent = '⏸';
        } else if (e.data === YT.PlayerState.PAUSED) {
          if (btn) btn.textContent = '▶';
        } else if (e.data === YT.PlayerState.ENDED) {
          // Auto-advance playlist
          if (_ytPlIdx < _ytPlaylist.length - 1) {
            _ytPlIdx++;
            const next = _ytPlaylist[_ytPlIdx];
            _ytCreatePlayer(next.id, next.title);
            const nowEl2 = document.getElementById('musicNowPlaying');
            if (nowEl2) nowEl2.textContent = next.title || 'Playing…';
          }
        }
      }
    }
  });
}

// ── Public: called from handleMusicCommand ───────────────────────────────────
function playYouTube(videoIds, titles, query) {
  _ytPlaylist = videoIds.map((id, i) => ({ id, title: titles[i] || query }));
  _ytPlIdx = 0;

  if (!_ytApiReady) {
    // API not ready yet — queue it
    _ytPendingId    = videoIds[0];
    _ytPendingTitle = titles[0] || query;
    const panel = document.getElementById('jarvisMusicPlayer');
    const nowEl = document.getElementById('musicNowPlaying');
    if (panel) panel.classList.remove('hidden');
    if (nowEl) nowEl.textContent = 'Loading YouTube player…';
    return;
  }
  _ytCreatePlayer(videoIds[0], titles[0] || query);
}

// ── Public: playback controls ────────────────────────────────────────────────
function musicPlayerCmd(cmd) {
  switch (cmd) {
    case 'toggle':
      if (!_ytPlayer) return;
      if (_ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        _ytPlayer.pauseVideo();
      } else {
        _ytPlayer.playVideo();
      }
      break;
    case 'pause':
      if (_ytPlayer) _ytPlayer.pauseVideo();
      break;
    case 'play':
      if (_ytPlayer) _ytPlayer.playVideo();
      break;
    case 'next':
      if (_ytPlIdx < _ytPlaylist.length - 1) {
        _ytPlIdx++;
        const n = _ytPlaylist[_ytPlIdx];
        _ytCreatePlayer(n.id, n.title);
        const nowEl = document.getElementById('musicNowPlaying');
        if (nowEl) nowEl.textContent = n.title || 'Next track';
      }
      break;
    case 'previous':
      if (_ytPlIdx > 0) {
        _ytPlIdx--;
        const p = _ytPlaylist[_ytPlIdx];
        _ytCreatePlayer(p.id, p.title);
        const nowEl = document.getElementById('musicNowPlaying');
        if (nowEl) nowEl.textContent = p.title || 'Previous track';
      } else if (_ytPlayer) {
        _ytPlayer.seekTo(0);
      }
      break;
    case 'mute':
      if (!_ytPlayer) return;
      if (_ytPlayer.isMuted()) { _ytPlayer.unMute(); } else { _ytPlayer.mute(); }
      break;
    case 'vol-up':
      if (_ytPlayer) _ytPlayer.setVolume(Math.min(100, (_ytPlayer.getVolume() || 50) + 15));
      break;
    case 'vol-down':
      if (_ytPlayer) _ytPlayer.setVolume(Math.max(0, (_ytPlayer.getVolume() || 50) - 15));
      break;
  }
}

// ── Public: close player ─────────────────────────────────────────────────────
function closeMusicPlayer() {
  if (_ytPlayer) { try { _ytPlayer.pauseVideo(); } catch (_) {} }
  const panel = document.getElementById('jarvisMusicPlayer');
  if (panel) panel.classList.add('hidden');
}

// ── Helper: check if player is active ────────────────────────────────────────
function isYTPlayerActive() {
  return _ytPlayer !== null && typeof _ytPlayer.getPlayerState === 'function';
}
