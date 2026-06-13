// ═══════════════════════════════════════════════
// JARVIS — Speech Recognition
// Interrupt-on-speak · Boss voice gate · Music pause
// Noise suppression pipeline · Noise gate · Mic meter
// ═══════════════════════════════════════════════

let _convListenTimer  = null;
let _interruptRecog   = null;   // Second SR instance — runs during TTS for interruptions
let _ttsStartedAt     = 0;      // Timestamp when TTS began (to filter feedback)

// ── Audio Pipeline: browser-level noise suppression + noise gate ─────────────
let _audioCtx       = null;
let _analyser       = null;
let _pipelineReady  = false;
let _meterRAF       = null;
let _noiseThreshold = parseFloat(localStorage.getItem('jarvisNoiseThreshold') || '0.018');

async function _initAudioPipeline() {
  if (_pipelineReady) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // remove JARVIS TTS echo
        noiseSuppression: true,   // browser-level noise filter
        autoGainControl:  true,   // normalize Boss's voice level
        channelCount:     1
      }
    });
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') await _audioCtx.resume();
    const src = _audioCtx.createMediaStreamSource(stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 512;
    _analyser.smoothingTimeConstant = 0.7;
    src.connect(_analyser);
    _pipelineReady = true;
    console.log('[JARVIS] Audio noise suppression pipeline active ✓');
    return true;
  } catch (e) {
    console.warn('[JARVIS] Audio pipeline init failed:', e.message);
    return false;
  }
}

// RMS audio level — 0 (silence) to ~0.1 (loud speech)
function _getAudioLevel() {
  if (!_analyser) return 0;
  const buf = new Uint8Array(_analyser.fftSize);
  _analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

// True when ambient noise is below threshold → safe to listen
function _isQuietEnough() {
  return !_pipelineReady || _getAudioLevel() < _noiseThreshold;
}

// Called by the noise threshold slider in the profile panel
function setNoiseThreshold(val) {
  _noiseThreshold = parseFloat(val);
  localStorage.setItem('jarvisNoiseThreshold', String(_noiseThreshold));
}

// Animate the mic level meter bar while listening
function _startMeterLoop() {
  const bar = document.getElementById('micLevelBar');
  if (!bar || !_analyser) return;
  const step = () => {
    if (!isListening && !_interruptRecog) { bar.style.width = '0%'; return; }
    const lvl = _getAudioLevel();
    const pct = Math.min(100, lvl * 1200);
    bar.style.width  = pct + '%';
    bar.style.background = lvl > _noiseThreshold * 3.5
      ? '#00d4ff'
      : lvl > _noiseThreshold
        ? '#4fc3f7'
        : '#2a3a4a';
    _meterRAF = requestAnimationFrame(step);
  };
  cancelAnimationFrame(_meterRAF);
  _meterRAF = requestAnimationFrame(step);
}

function _stopMeterLoop() {
  cancelAnimationFrame(_meterRAF);
  _meterRAF = null;
  const bar = document.getElementById('micLevelBar');
  if (bar) { bar.style.width = '0%'; bar.style.background = '#2a3a4a'; }
}

// ── Build a SpeechRecognition instance ──────────────────────────────────────
function _buildRecog(isInterrupt) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous     = false;
  r.interimResults = false;
  r.lang = (LANG_MAP_TTS[currentLanguage] || 'en-US');

  // ── onspeechstart: user voice detected → immediately cut JARVIS ──────────
  r.onspeechstart = () => {
    // Guard: ignore if within 1500ms of TTS starting (feedback / TTS echo pickup)
    if (Date.now() - _ttsStartedAt < 1500) return;

    if (isCurrentlySpeaking) {
      stopSpeaking();               // kill TTS immediately
      clearTimeout(_convListenTimer);
    }
    // Pause music so command is heard cleanly
    if (typeof isYTPlayerActive === 'function' && isYTPlayerActive()) {
      if (typeof musicPlayerCmd === 'function') musicPlayerCmd('pause');
      window._jarvisMusicPausedForCmd = true;
    }
    setStatus(isVerifiedBoss ? '🎤 YES, BOSS…' : '🎤 LISTENING…', true);
  };

  // ── onresult: process the transcribed command ─────────────────────────────
  r.onresult = e => {
    const transcript = (e.results[0][0].transcript || '').trim();
    if (!transcript) {
      if (isInterrupt) { _interruptRecog = null; return; }
      stopListening();
      if (conversationMode && !isLoading) autoListenAfterSpeak();
      return;
    }

    // ── BOSS-ONLY VOICE GATE ─────────────────────────────────────────────
    const bossOnly = localStorage.getItem('jarvisBossOnlyVoice') === 'true';
    if (bossOnly && !isVerifiedBoss) {
      if (isInterrupt) { stopInterruptListener(); } else { stopListening(); }
      addMessage('user', transcript);
      addMessage('ai', '🔒 Voice command blocked — Boss verification required. Please verify your identity first, Boss.');
      if (typeof speak === 'function') speak('Identity verification required.');
      if (conversationMode) setTimeout(autoListenAfterSpeak, 1000);
      return;
    }

    // ── Deliver the command ───────────────────────────────────────────────
    if (isInterrupt) {
      stopInterruptListener();
      // Hand off to main flow without starting a new main recognition
      recognition = null;
      isListening = false;
    } else {
      stopListening();
    }
    document.getElementById('userInput').value = transcript;
    autoResize(document.getElementById('userInput'));
    setTimeout(sendMessage, 50);
  };

  r.onerror = (e) => {
    const code = (e && e.error) || '';
    if (isInterrupt) {
      _interruptRecog = null;
      return;
    }
    stopListening();
    // Don't restart on permanent errors — would create an infinite loop
    if (code === 'not-allowed' || code === 'audio-capture' || code === 'service-not-allowed') return;
    if (conversationMode && !isLoading) autoListenAfterSpeak();
  };

  r.onend = () => {
    if (isInterrupt) {
      _interruptRecog = null;
      // Restart interrupt listener to stay ready while TTS continues.
      // Reset _ttsStartedAt so the fresh listener has a full echo-guard window.
      if (isCurrentlySpeaking && conversationMode) {
        _ttsStartedAt = Date.now();        // refresh echo guard for new instance
        setTimeout(startInterruptListener, 600); // was 250ms — longer gap avoids echo
      }
    } else {
      if (isListening) {
        stopListening();
        if (conversationMode && !isLoading) autoListenAfterSpeak();
      }
    }
  };

  return r;
}

function initSpeech() { return _buildRecog(false); }

// ── Interrupt listener: runs DURING TTS so boss can cut in any time ──────────
function startInterruptListener() {
  if (!conversationMode || _interruptRecog || isListening) return;
  const r = _buildRecog(true);
  if (!r) return;
  _interruptRecog = r;
  try { r.start(); } catch(e) { _interruptRecog = null; }
}

function stopInterruptListener() {
  if (_interruptRecog) {
    try { _interruptRecog.stop(); } catch(e) {}
    _interruptRecog = null;
  }
}

// ── Auto-restart listening after JARVIS finishes speaking ────────────────────
function autoListenAfterSpeak() {
  if (!conversationMode) return;
  stopInterruptListener();
  clearTimeout(_convListenTimer);
  _convListenTimer = setTimeout(() => {
    if (!conversationMode || isLoading || isListening) return;
    recognition = initSpeech();
    if (!recognition) return;
    isListening = true;
    const micBtn = document.getElementById('micBtn');
    if (micBtn) { micBtn.classList.add('listening', 'conv-listening'); micBtn.textContent = '🔴'; }
    setStatus(isVerifiedBoss ? '💬 YOUR TURN, BOSS…' : '💬 YOUR TURN…', true);
    _startMeterLoop();
    try {
      recognition.start();
    } catch(e) {
      // Chrome can throw if mic is busy (e.g. audio pipeline still initialising)
      isListening = false;
      _stopMeterLoop();
      if (conversationMode) setTimeout(autoListenAfterSpeak, 600); // retry once
    }
  }, 220);
}

// ── Toggle hands-free conversation mode ──────────────────────────────────────
function toggleConversationMode() {
  conversationMode = !conversationMode;
  const btn   = document.getElementById('convModeBtn');
  const input = document.getElementById('userInput');
  if (conversationMode) {
    btn?.classList.add('active');
    if (input) input.placeholder = 'Hands-free ON — speak freely or type…';
    setStatus('💬 ALWAYS LISTENING — ACTIVE', true);
    setTimeout(() => setStatus('✓ SYSTEM ONLINE'), 2500);
    // Defer pipeline init — don't block conversation start
    setTimeout(() => _initAudioPipeline(), 800);
    if (!isCurrentlySpeaking && !isLoading) autoListenAfterSpeak();
  } else {
    btn?.classList.remove('active');
    clearTimeout(_convListenTimer);
    stopListening();
    stopInterruptListener();
    _stopMeterLoop();
    if (input) input.placeholder = 'Type a command or speak…  (Shift+Enter for new line)';
    setStatus('CONVERSATION MODE OFF');
    setTimeout(() => setStatus('✓ SYSTEM ONLINE'), 2000);
  }
}

// ── Manual mic button — also interrupts TTS if it's playing ─────────────────
function toggleMic() {
  if (isListening) { stopListening(); return; }

  if (isCurrentlySpeaking) stopSpeaking();
  stopInterruptListener();

  // Warm up pipeline (no-op if already ready)
  _initAudioPipeline();

  recognition = initSpeech();
  if (!recognition) { alert('Voice input not supported. Please use Chrome.'); return; }
  isListening = true;
  const btn = document.getElementById('micBtn');
  if (btn) { btn.classList.add('listening'); btn.textContent = '🔴'; }
  setStatus(isVerifiedBoss ? '🎤 YES, BOSS — LISTENING…' : `🎤 LISTENING (${currentLanguage.toUpperCase()})…`, true);
  _startMeterLoop();
  recognition.start();
}

function stopListening() {
  isListening = false;
  _stopMeterLoop();
  const btn = document.getElementById('micBtn');
  if (btn) { btn.classList.remove('listening', 'conv-listening'); btn.textContent = '🎤'; }
  if (!conversationMode) setStatus('SYSTEM ONLINE');
  try { if (recognition) recognition.stop(); } catch(e) {}
}

