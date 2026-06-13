// ═══════════════════════════════════════════════
// JARVIS — Text-to-Speech
// ═══════════════════════════════════════════════

let _ttsSynthKeepalive = null;   // Chrome 15s TTS bug keepalive interval
let _ttsPendingId      = 0;      // Generation ID — prevents cancel+speak race on rapid calls
let _ttsBlinkStart     = 0;      // Timestamp of onstart — detects instant-end blink bug
let _ttsBlinkRetries   = 0;      // Max 2 retries for blink bug recovery

function speak(text) {
  if (!speakerEnabled) {
    // Even with speaker off, conversation mode must keep looping
    if (typeof autoListenAfterSpeak === 'function') setTimeout(autoListenAfterSpeak, 400);
    return;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (window._jarvisTTSAudio) { window._jarvisTTSAudio.pause(); window._jarvisTTSAudio = null; }

  const cleanText = text
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
    .replace(/```[\s\S]*?```/g, 'code block')
    .replace(/`([^`]+)`/g, '$1').replace(/##+ /g, '').replace(/[-*+] /g, '')
    .trim();
  if (!cleanText) return;

  // ── Non-English: Google Translate TTS via server proxy ──
  if (currentLanguage && currentLanguage !== 'en') {
    const speakerBtn = document.getElementById('speakerBtn');
    if (speakerBtn) { speakerBtn.classList.add('active'); speakerBtn.title = 'Speaking...'; }
    isCurrentlySpeaking = true;
    window._ttsStartedAt = Date.now();
    if (typeof (_ttsStartedAt) !== 'undefined') _ttsStartedAt = Date.now();

    // Interrupt listener — boss can speak any time during TTS
    if (typeof startInterruptListener === 'function') {
      setTimeout(startInterruptListener, 1500); // safe delay past TTS onset echo
    }

    const chunks = [];
    for (let i = 0; i < cleanText.length; i += 180) chunks.push(cleanText.slice(i, i + 180));

    let idx = 0;
    function playNext() {
      if (idx >= chunks.length || !isCurrentlySpeaking) {
        isCurrentlySpeaking = false;
        if (speakerBtn) { speakerBtn.classList.remove('active'); speakerBtn.title = 'Toggle Speaker'; }
        if (typeof stopInterruptListener === 'function') stopInterruptListener();
        if (typeof autoListenAfterSpeak === 'function') autoListenAfterSpeak();
        return;
      }
      const audio = new Audio(`/api/tts?text=${encodeURIComponent(chunks[idx])}&lang=${currentLanguage}`);
      window._jarvisTTSAudio = audio;
      idx++;
      audio.onended  = playNext;
      audio.onerror  = () => { console.warn('TTS chunk failed, skipping'); playNext(); };
      audio.play().catch(() => playNext());
    }
    playNext();
    return;
  }

  // ── English: Web Speech API ──
  if (!window.speechSynthesis) return;
  const targetLang = LANG_MAP_TTS[currentLanguage] || 'en-US';
  const voices     = getCachedVoices();

  // Use user-selected voice first, then fall back to language match
  let selectedVoice = null;
  if (selectedVoiceURI) {
    selectedVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
  }
  if (!selectedVoice) {
    selectedVoice = voices.find(v => v.lang === targetLang)
                 || voices.find(v => v.lang.startsWith('en'));
  }

  const utterance     = new SpeechSynthesisUtterance(cleanText);
  utterance.lang      = targetLang;
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.rate   = 0.88;
  utterance.pitch  = 1.0;
  utterance.volume = 1.0;

  utterance.onstart = () => {
    isCurrentlySpeaking = true;
    _ttsStartedAt  = Date.now();
    _ttsBlinkStart = Date.now();          // record start time for blink detection
    const btn = document.getElementById('speakerBtn');
    if (btn) btn.classList.add('active');
    // Chrome TTS 15s bug fix: Chrome silently stops speechSynthesis after ~15s.
    // Calling pause()+resume() every 10s keeps it alive for any length response.
    clearInterval(_ttsSynthKeepalive);
    _ttsSynthKeepalive = setInterval(() => {
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
    // Start interrupt listener so boss can cut in mid-speech
    if (typeof startInterruptListener === 'function') {
      setTimeout(startInterruptListener, 1500); // 1500ms: safe delay past TTS onset echo
    }
  };
  utterance.onend = () => {
    clearInterval(_ttsSynthKeepalive); _ttsSynthKeepalive = null;
    isCurrentlySpeaking = false;
    const btn = document.getElementById('speakerBtn');
    if (btn) { btn.classList.remove('active'); btn.title = 'Toggle Speaker'; }
    if (typeof stopInterruptListener === 'function') stopInterruptListener();

    // ── Blink bug detection ──────────────────────────────────────────────────
    // Chrome sometimes fires onstart + onend instantly with no audio (the "blink").
    // If TTS ended within 600ms of starting, retry up to 2 times with a clean delay.
    const elapsed = Date.now() - _ttsBlinkStart;
    if (elapsed < 600 && _ttsBlinkRetries < 2) {
      _ttsBlinkRetries++;
      console.warn(`[JARVIS TTS] Blink detected (${elapsed}ms). Retry ${_ttsBlinkRetries}/2…`);
      setTimeout(() => speak(text), 300);
      return;   // don't call autoListenAfterSpeak yet — we're retrying
    }
    _ttsBlinkRetries = 0;
    if (typeof autoListenAfterSpeak === 'function') autoListenAfterSpeak();
  };
  utterance.onerror = (e) => {
    clearInterval(_ttsSynthKeepalive); _ttsSynthKeepalive = null;
    isCurrentlySpeaking = false;
    _ttsBlinkRetries = 0;
    const btn = document.getElementById('speakerBtn');
    if (btn) btn.classList.remove('active');
    if (typeof stopInterruptListener === 'function') stopInterruptListener();
    if (typeof autoListenAfterSpeak === 'function') autoListenAfterSpeak();
  };

  // ── Chrome cancel+speak race fix ─────────────────────────────────────────
  // Calling speechSynthesis.speak() in the same tick as cancel() causes Chrome
  // to fire onstart but play no audio.  A 60ms gap reliably prevents this.
  const speakId = ++_ttsPendingId;
  setTimeout(() => {
    if (speakId !== _ttsPendingId) return;   // a newer speak() was called — abort
    if (!speakerEnabled) { if (typeof autoListenAfterSpeak==='function') autoListenAfterSpeak(); return; }
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  }, 60);
}

function stopSpeaking() {
  clearInterval(_ttsSynthKeepalive); _ttsSynthKeepalive = null;
  isCurrentlySpeaking = false;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (window._jarvisTTSAudio) { window._jarvisTTSAudio.pause(); window._jarvisTTSAudio = null; }
  const btn = document.getElementById('speakerBtn');
  if (btn) btn.classList.remove('active');
}

function toggleSpeaker() {
  speakerEnabled = !speakerEnabled;
  const btn = document.getElementById('speakerBtn');
  if (speakerEnabled) {
    btn.classList.remove('muted'); btn.textContent = '🔊';
    setStatus('SPEAKER: ON');
  } else {
    btn.classList.add('muted'); btn.textContent = '🔇';
    stopSpeaking(); setStatus('SPEAKER: OFF');
  }
  setTimeout(() => setStatus('SYSTEM ONLINE'), 2000);
}

function toggleWakeWord() {
  if (typeof WakeWord === 'undefined') {
    console.warn('[JARVIS] Wake word module not loaded');
    return;
  }
  const isNowActive = WakeWord.toggle();
  localStorage.setItem('jarvisWakeWordEnabled', isNowActive ? 'true' : 'false');

  const btn = document.getElementById('wakeWordBtn');
  if (btn) {
    btn.style.opacity = isNowActive ? '1' : '0.6';
    btn.title = isNowActive ? 'Wake Word ON — Say "Hey JARVIS"' : 'Wake Word OFF';
    btn.textContent = isNowActive ? '👁‍🗨' : '👁';
  }
  setStatus(isNowActive ? 'WAKE WORD: ON — Say "Hey JARVIS"' : 'WAKE WORD: OFF');
  setTimeout(() => setStatus('SYSTEM ONLINE'), 3000);
}
