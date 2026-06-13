// ═══════════════════════════════════════════════
// JARVIS — UI Helpers + Language
// ═══════════════════════════════════════════════

function setMode(el, mode) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  currentMode = mode;
  document.getElementById('modeIndicator').textContent = MODE_LABELS[mode];
}

function setStatus(txt, isErr = false) {
  const lbl = document.getElementById('statusLabel');
  const dot = document.getElementById('statusDot');
  if (lbl) lbl.textContent = txt;
  if (dot) {
    dot.style.background  = isErr ? 'var(--red)'   : 'var(--green)';
    dot.style.boxShadow   = isErr ? '0 0 6px var(--red)' : '0 0 6px var(--green)';
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function sendChip(el) {
  document.getElementById('userInput').value = el.textContent;
  sendMessage();
}

function scrollToBottom() {
  const m = document.getElementById('messages');
  if (m) m.scrollTop = m.scrollHeight;
}

function clearChat() {
  document.getElementById('messages').innerHTML = `
    <div class="welcome" id="welcomeScreen">
      <div class="welcome-icon">⬡</div>
      <h2>JARVIS READY</h2>
      <p>Chat cleared. Ready for new commands.</p>
    </div>`;
  document.getElementById('historyList').innerHTML =
    `<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">No history yet.</span>`;
  conversationHistory = [];
}

// ── Language ──
function setLanguage(lang) {
  currentLanguage = lang;
  localStorage.setItem('jarvisLanguage', lang);
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  recognition = null; // reset speech engine for new lang
  setStatus(`✓ ${LANG_NAMES[lang] || lang}`);
  setTimeout(() => setStatus('SYSTEM ONLINE'), 2000);
}

function loadLanguage() {
  const saved = localStorage.getItem('jarvisLanguage');
  if (saved) {
    currentLanguage = saved;
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === saved);
    });
  }
}

function translate(key) {
  return (TRANSLATIONS[currentLanguage] || {})[key] || (TRANSLATIONS['en'] || {})[key] || key;
}
