// ═══════════════════════════════════════════════
// JARVIS — Identity Verification System
// "Yes, Boss." — Only for the authorized user
// ═══════════════════════════════════════════════

function initVerification() {
  const overlay = document.getElementById('verifyOverlay');
  if (!overlay) return;

  // Brief pause so page renders fully first
  setTimeout(() => {
    overlay.classList.add('visible');
    setTimeout(() => {
      document.getElementById('verifyInput')?.focus();
      // JARVIS announces the challenge
      if (typeof speak === 'function') {
        speak('Identity verification required. Please state your name.');
      }
    }, 700);
  }, 500);
}

function verifyIdentity() {
  const input = document.getElementById('verifyInput');
  const val   = (input?.value || '').trim();

  if (!val) {
    showVerifyStatus('Please state your name, Boss.', 'warn');
    return;
  }

  const registeredName = (userProfile.name || '').trim();

  // No profile set up yet — skip boss mode
  if (!registeredName || registeredName === 'User') {
    isVerifiedBoss = false;
    _closeVerifyOverlay(false);
    return;
  }

  if (val.toLowerCase() === registeredName.toLowerCase()) {
    // ✅ IDENTITY CONFIRMED
    isVerifiedBoss = true;
    showVerifyStatus('✓  IDENTITY CONFIRMED', 'success');
    document.getElementById('verifyOverlay')?.classList.add('verified');
    setTimeout(() => {
      _closeVerifyOverlay(true);
    }, 1400);
  } else {
    // ❌ NOT RECOGNIZED
    isVerifiedBoss = false;
    showVerifyStatus('⚠  IDENTITY NOT RECOGNIZED', 'error');
    const box = document.getElementById('verifyOverlay');
    if (box) {
      box.classList.add('denied');
      setTimeout(() => box.classList.remove('denied'), 800);
    }
    input.value = '';
    setTimeout(() => {
      showVerifyStatus('Access limited. You may still use JARVIS.', 'warn');
    }, 900);
    setTimeout(() => _closeVerifyOverlay(false), 2600);
  }
}

function _closeVerifyOverlay(isBoss) {
  const overlay = document.getElementById('verifyOverlay');
  if (!overlay) return;
  overlay.classList.add('closing');
  setTimeout(() => {
    overlay.style.display = 'none';
    setTimeout(() => {
      if (typeof addMessage !== 'function') return;
      if (isBoss) {
        const msg = `All systems are operational, Boss. JARVIS is fully online and at your service. How may I assist you today?`;
        addMessage('ai', msg);
        if (typeof speak === 'function') speak('All systems operational, Boss. How may I assist you today?');
      } else if (!isVerifiedBoss) {
        addMessage('ai', `Welcome. Identity verification failed or no profile found. You may use JARVIS freely. To enable Boss mode, set your name in the profile panel.`);
      }
    }, 100);
  }, 600);
}

function showVerifyStatus(msg, type) {
  const el = document.getElementById('verifyStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'verify-status ' + type;
}

// Voice input for verification
function voiceVerify() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showVerifyStatus('Voice not supported — type your name.', 'warn');
    return;
  }
  const r = new SR();
  r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
  showVerifyStatus('🎤  Listening…', 'listening');
  r.onresult = (e) => {
    const name = e.results[0][0].transcript.trim();
    document.getElementById('verifyInput').value = name;
    verifyIdentity();
  };
  r.onerror = () => showVerifyStatus('Voice capture failed. Type your name.', 'warn');
  r.start();
}

// Skip verification (guest access)
function skipVerification() {
  isVerifiedBoss = false;
  _closeVerifyOverlay(false);
}

// Enter key handler
function _verifyKeydown(e) {
  if (e.key === 'Enter') verifyIdentity();
}
