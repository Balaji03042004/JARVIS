const dot        = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const pageTitle  = document.getElementById('page-title');
const platBadge  = document.getElementById('platform-badge');
const quickBtns  = document.getElementById('quick-btns');

// Get current tab info
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) return;
  pageTitle.textContent = tab.title || tab.url;
  const platform = detectPlatform(tab.url);
  platBadge.textContent = platform;
  platBadge.className = `platform-badge platform-${platform}`;

  // Show YouTube-specific buttons
  if (platform === 'youtube') {
    quickBtns.innerHTML = `
      <button onclick="cmd('yt_play')">▶ Play</button>
      <button onclick="cmd('yt_pause')">⏸ Pause</button>
      <button onclick="cmd('yt_next')">⏭ Next</button>
      <button onclick="cmd('yt_volume_up')">🔊 Vol+</button>
      <button onclick="cmd('yt_volume_down')">🔉 Vol-</button>
      <button onclick="cmd('yt_mute')">🔇 Mute</button>
      <button onclick="cmd('yt_fullscreen')">⛶ Full</button>
      <button onclick="cmd('yt_seek', {seconds:10})">+10s</button>
      <button onclick="cmd('yt_seek', {seconds:-10})">-10s</button>
    `;
    quickBtns.className = 'quick-btns yt-mode';
  }
});

// Check WS connection status via background
chrome.runtime.sendMessage({ type: 'get_status' }, (resp) => {
  if (resp?.connected) {
    dot.classList.add('connected');
    statusText.textContent = 'Connected to JARVIS';
  } else {
    statusText.textContent = 'JARVIS server not running';
  }
});

function cmd(action, data = {}) {
  chrome.runtime.sendMessage({ type: 'quick_command', action, data });
}

function detectPlatform(url) {
  if (!url) return 'web';
  if (url.includes('youtube.com'))  return 'youtube';
  if (url.includes('google.com'))   return 'google';
  if (url.includes('github.com'))   return 'github';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  return 'web';
}
