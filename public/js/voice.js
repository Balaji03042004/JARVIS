// ═══════════════════════════════════════════════
// JARVIS — Voice Selector + Voice Command Handler
// ═══════════════════════════════════════════════

// ── Intercept natural-language voice change commands ──────────────────────────
// Called from sendMessage() BEFORE sending to the AI.
// Returns true if a voice command was handled (stops the message going to Groq).
function handleVoiceCommand(text) {
  const t = text.toLowerCase().trim();

  // Must contain some hint of a voice/sound change intent
  const isVoiceIntent =
    /(change|switch|use|set|make|turn|pick|select|try|give me|want).{0,25}(voice|sound|speak|tone)/i.test(t) ||
    /(voice|sound|speak|tone).{0,15}(change|switch|to|be|male|female|different)/i.test(t) ||
    /^(male|female|man|woman|british|indian|australian|american)\s*(voice)?$/.test(t) ||
    /(speak|talk)\s+(like|as)\s+a?\s*(male|female|man|woman)/i.test(t);

  if (!isVoiceIntent) return false;

  const voices = getCachedVoices();
  if (!voices.length) {
    // Voices not loaded yet — can't switch
    _jarvisLocalReply(`I can't load the voice list right now, ${isVerifiedBoss ? 'Boss' : 'sir'}. Open the 👤 profile panel and click ↺ to load voices first.`);
    return true;
  }

  // ── Determine what the user wants ──
  const wantsFemale   = /\b(female|woman|girl|feminine|lady)\b/.test(t);
  const wantsMale     = /\b(male|man|guy|masculine|deep|boy)\b/.test(t) && !wantsFemale;
  const wantsBritish  = /\b(british|uk|england|english accent)\b/.test(t);
  const wantsIndian   = /\b(indian|india|hindi accent)\b/.test(t);
  const wantsAussie   = /\b(australian|aussie|australia)\b/.test(t);
  const wantsAmerican = /\b(american|us accent|united states)\b/.test(t);

  // Specific voice name mentioned? e.g. "use Samantha", "switch to David"
  const nameMatch = t.match(/(?:use|switch to|change to|try)\s+([a-z]+(?:\s+[a-z]+)?)\s*(?:voice)?$/i);
  const specificName = nameMatch ? nameMatch[1].trim() : null;

  let target = null;

  if (specificName) {
    target = voices.find(v => v.name.toLowerCase().includes(specificName.toLowerCase()));
  }

  if (!target && wantsBritish && wantsFemale) {
    target = voices.find(v => /female/i.test(v.name) && v.lang === 'en-GB')
          || voices.find(v => v.lang === 'en-GB' && !/male/i.test(v.name));
  }
  if (!target && wantsBritish && wantsMale) {
    target = voices.find(v => /male/i.test(v.name) && v.lang === 'en-GB')
          || voices.find(v => v.lang === 'en-GB');
  }
  if (!target && wantsBritish) {
    target = voices.find(v => v.lang === 'en-GB');
  }
  if (!target && wantsIndian) {
    target = voices.find(v => v.lang === 'en-IN' || v.lang === 'hi-IN');
  }
  if (!target && wantsAussie) {
    target = voices.find(v => v.lang === 'en-AU');
  }
  if (!target && wantsAmerican) {
    target = voices.find(v => v.lang === 'en-US' && wantsFemale && /female|samantha|zira|aria|cortana/i.test(v.name))
          || voices.find(v => v.lang === 'en-US' && wantsMale   && /male|david|mark|guy/i.test(v.name))
          || voices.find(v => v.lang === 'en-US');
  }

  // Gender-only match (no specific accent)
  if (!target && wantsFemale) {
    target = voices.find(v => /female/i.test(v.name) && v.lang.startsWith('en'))
          || voices.find(v => /samantha|zira|victoria|karen|moira|tessa|fiona|veena|nora|aria|cortana|eva|lisa|linda|julia|emma|alice|emily|susan/i.test(v.name) && v.lang.startsWith('en'))
          || voices.find(v => /samantha|zira|victoria|karen|moira|tessa|fiona|veena|nora|aria|cortana/i.test(v.name));
  }
  if (!target && wantsMale) {
    target = voices.find(v => /male/i.test(v.name) && v.lang.startsWith('en'))
          || voices.find(v => /david|mark|daniel|alex|fred|george|arthur|thomas|richard|james|guy/i.test(v.name) && v.lang.startsWith('en'))
          || voices.find(v => /david|mark|daniel|alex|fred|george|arthur|thomas|richard|james/i.test(v.name));
    // Last resort: pick any English voice that isn't female-named and isn't current
    if (!target) {
      target = voices.find(v =>
        v.lang.startsWith('en') &&
        !/female|samantha|zira|victoria|karen|moira|tessa|fiona|veena|nora|aria|cortana/i.test(v.name) &&
        v.voiceURI !== selectedVoiceURI
      );
    }
  }

  if (!target) {
    const wantDesc = specificName || (wantsFemale ? 'female' : wantsMale ? 'male' : 'that');
    _jarvisLocalReply(`No ${wantDesc} voice found on this system${isVerifiedBoss ? ', Boss' : ''}. Open the 👤 profile panel to see all ${voices.length} available voices.`);
    return true;
  }

  // ── Apply the voice change ──
  selectVoice(target.voiceURI);

  const genderWord = /female|woman|samantha|zira|victoria|karen|moira|tessa|fiona|aria|cortana/i.test(target.name) ? 'female' : 'male';
  const reply = isVerifiedBoss
    ? `Switched to ${target.name} — ${genderWord} voice, Boss.`
    : `Switched to ${target.name}.`;

  addMessage('ai', reply);
  // speak() in addMessage will use new voice — but addMessage calls speak internally
  // so we skip the extra speak call here since addMessage already triggers it.
  return true;
}

// Shortcut: add an AI message and speak it
function _jarvisLocalReply(text) {
  addMessage('ai', text);
}

function loadVoiceSelector() {
  const container = document.getElementById('voiceList');
  if (!container) return;

  // Voices may not be loaded yet — retry
  let voices = getCachedVoices();
  if (!voices.length) {
    window.speechSynthesis.getVoices(); // trigger load
    setTimeout(loadVoiceSelector, 400);
    return;
  }

  // Filter to only voices matching current UI language (or all English if en)
  const targetPrefix = (LANG_MAP_TTS[currentLanguage] || 'en-US').split('-')[0];
  const filtered = voices.filter(v => v.lang.startsWith(targetPrefix));
  const list = filtered.length ? filtered : voices; // fallback: show all

  container.innerHTML = '';

  // Group by detected gender
  const groups = { '♀ Female': [], '♂ Male': [], '◈ Neutral': [] };
  list.forEach(v => {
    const n = v.name.toLowerCase();
    if (/female|woman|girl|zira|cortana|samantha|victoria|karen|moira|tessa|fiona|veena|nora|aria|susan|alice|emily|emma|linda|julia|lisa/i.test(n))
      groups['♀ Female'].push(v);
    else if (/male|man|david|mark|daniel|alex|fred|jorge|diego|james|george|arthur|thomas|richard/i.test(n))
      groups['♂ Male'].push(v);
    else
      groups['◈ Neutral'].push(v);
  });

  let hasAny = false;
  Object.entries(groups).forEach(([label, gVoices]) => {
    if (!gVoices.length) return;
    hasAny = true;
    const header = document.createElement('div');
    header.className = 'voice-group-label';
    header.textContent = label;
    container.appendChild(header);

    gVoices.forEach(v => {
      const row = document.createElement('div');
      row.className = 'voice-item' + (v.voiceURI === selectedVoiceURI ? ' active' : '');
      row.dataset.uri = v.voiceURI;
      const local = v.localService ? '<span class="voice-tag local">LOCAL</span>' : '<span class="voice-tag net">CLOUD</span>';
      row.innerHTML = `
        <span class="voice-name">${v.name}</span>
        <span class="voice-meta">${v.lang} ${local}</span>
        <button class="voice-preview-btn" title="Preview" onclick="previewVoice('${v.voiceURI}',event)">▶</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('voice-preview-btn')) return;
        selectVoice(v.voiceURI);
      });
      container.appendChild(row);
    });
  });

  if (!hasAny) {
    container.innerHTML = '<span class="voice-empty">No voices found. Try a different language or browser.</span>';
  }
}

function selectVoice(uri) {
  selectedVoiceURI = uri;
  localStorage.setItem('jarvisVoiceURI', uri);
  // Update active state visually
  document.querySelectorAll('.voice-item').forEach(el => {
    el.classList.toggle('active', el.dataset.uri === uri);
  });
  // Auto-preview the selected voice
  previewVoice(uri);
}

function previewVoice(uri, e) {
  if (e) e.stopPropagation();
  const voice = getCachedVoices().find(v => v.voiceURI === uri);
  if (!voice || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(
    isVerifiedBoss ? 'Voice confirmed, Boss. JARVIS online.' : 'Voice selected. JARVIS online.'
  );
  utt.voice  = voice;
  utt.rate   = 0.9;
  utt.pitch  = 1.0;
  utt.volume = 1.0;
  window.speechSynthesis.speak(utt);
}

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — Wake Word Engine ("Hey JARVIS")
// Continuously listens in the background. When "hey jarvis" or "jarvis" is
// detected at the start of speech, switches into command-capture mode.
// ═══════════════════════════════════════════════════════════════════════════════

const WakeWord = (() => {
  const WAKE_PATTERNS = [
    /^hey\s+jarvis\b/i,
    /^ok\s+jarvis\b/i,
    /^jarvis\b/i,
    /^okay\s+jarvis\b/i,
  ];

  const STRIP_WAKE = /^(?:hey|ok|okay)\s+jarvis\s*/i;

  let _wakeRecognizer   = null;
  let _commandRecognizer = null;
  let _active           = false;
  let _inCommand        = false;
  let _indicator        = null;

  // ── Visual Indicator ────────────────────────────────────────────────────
  function _createIndicator() {
    let el = document.getElementById('jarvis-wake-indicator');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'jarvis-wake-indicator';
    el.style.cssText = `
      position: fixed; bottom: 80px; right: 20px; z-index: 9999;
      background: rgba(0,0,0,0.75); color: #00e5ff; border: 1px solid #00e5ff;
      border-radius: 20px; padding: 6px 14px; font-size: 11px; font-family: monospace;
      backdrop-filter: blur(6px); pointer-events: none; transition: opacity 0.3s;
      opacity: 0;
    `;
    document.body.appendChild(el);
    return el;
  }

  function _showIndicator(text, color = '#00e5ff') {
    const el = _indicator || (_indicator = _createIndicator());
    el.textContent = text;
    el.style.color  = color;
    el.style.borderColor = color;
    el.style.opacity = '1';
  }

  function _hideIndicator() {
    if (_indicator) _indicator.style.opacity = '0';
  }

  // ── Wake Word Listener ──────────────────────────────────────────────────
  function _startWakeListener() {
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    _wakeRecognizer = new SR();
    _wakeRecognizer.continuous = true;
    _wakeRecognizer.interimResults = true;
    _wakeRecognizer.lang = 'en-US';
    _wakeRecognizer.maxAlternatives = 3;

    _wakeRecognizer.onresult = (event) => {
      if (_inCommand) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.trim();
        const isWakeWord = WAKE_PATTERNS.some(p => p.test(transcript));
        if (isWakeWord) {
          const commandPart = transcript.replace(STRIP_WAKE, '').trim();
          _onWakeWordDetected(commandPart);
          break;
        }
      }
    };

    _wakeRecognizer.onend = () => {
      // Auto-restart if still active and not in command mode
      if (_active && !_inCommand) {
        setTimeout(() => {
          try { _wakeRecognizer.start(); } catch (_) {}
        }, 300);
      }
    };

    _wakeRecognizer.onerror = (e) => {
      if (e.error === 'not-allowed') {
        console.warn('[JARVIS Wake] Microphone permission denied');
        _active = false;
        _hideIndicator();
      }
    };

    try {
      _wakeRecognizer.start();
      _showIndicator('👂 Listening for "Hey JARVIS"');
      console.log('[JARVIS Wake] Wake word listener started');
    } catch (err) {
      console.warn('[JARVIS Wake] Could not start:', err.message);
    }
  }

  // ── Wake Word Detected — Capture Command ─────────────────────────────────
  function _onWakeWordDetected(inlineCommand) {
    _inCommand = true;
    if (_wakeRecognizer) {
      try { _wakeRecognizer.stop(); } catch (_) {}
    }

    _showIndicator('🟢 JARVIS — Speak your command...', '#00ff99');
    window.speechSynthesis?.cancel();

    // If the wake phrase already contains a command (e.g. "Hey JARVIS open YouTube"),
    // execute it immediately without another listening round
    if (inlineCommand && inlineCommand.length > 2) {
      _executeCommand(inlineCommand);
      return;
    }

    // Otherwise, start a focused command recognizer
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    _commandRecognizer = new SR();
    _commandRecognizer.lang = 'en-US';
    _commandRecognizer.interimResults = false;
    _commandRecognizer.maxAlternatives = 1;

    let _cmdTimeout = setTimeout(() => {
      try { _commandRecognizer.stop(); } catch (_) {}
    }, 8000); // 8s timeout

    _commandRecognizer.onresult = (event) => {
      clearTimeout(_cmdTimeout);
      const cmd = event.results[0][0].transcript.trim();
      _executeCommand(cmd);
    };

    _commandRecognizer.onend = () => {
      clearTimeout(_cmdTimeout);
      _endCommandMode();
    };

    _commandRecognizer.onerror = () => {
      clearTimeout(_cmdTimeout);
      _endCommandMode();
    };

    try { _commandRecognizer.start(); } catch (e) {
      _endCommandMode();
    }
  }

  // ── Execute the captured command ─────────────────────────────────────────
  function _executeCommand(cmd) {
    if (!cmd) { _endCommandMode(); return; }

    console.log('[JARVIS Wake] Command:', cmd);
    _showIndicator(`⚡ "${cmd}"`, '#ffffff');

    // Inject into the chat input and submit
    const input = document.getElementById('messageInput') || document.querySelector('input[type="text"], textarea');
    if (input) {
      input.value = cmd;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Auto-send after a brief delay for UI update
    setTimeout(() => {
      if (typeof sendMessage === 'function') {
        sendMessage(cmd);
      } else {
        // Fallback: fire the send button
        const btn = document.getElementById('sendBtn') || document.querySelector('[data-action="send"]');
        if (btn) btn.click();
      }
      _endCommandMode();
    }, 200);
  }

  // ── Return to wake word listening mode ────────────────────────────────────
  function _endCommandMode() {
    _inCommand = false;
    if (_active) {
      _showIndicator('👂 Listening for "Hey JARVIS"');
      setTimeout(() => {
        try { _wakeRecognizer?.start(); } catch (_) { _startWakeListener(); }
      }, 500);
    } else {
      _hideIndicator();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function start() {
    if (_active) return;
    _active = true;
    _startWakeListener();
  }

  function stop() {
    _active = false;
    _inCommand = false;
    try { _wakeRecognizer?.stop();   } catch (_) {}
    try { _commandRecognizer?.stop();} catch (_) {}
    _hideIndicator();
    console.log('[JARVIS Wake] Stopped');
  }

  function isActive() { return _active; }

  function toggle() {
    if (_active) stop(); else start();
    return _active;
  }

  return { start, stop, toggle, isActive };
})();

// ── Expose globally ──────────────────────────────────────────────────────────
window.WakeWord = WakeWord;

// ── Auto-restore wake word mode from localStorage ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('jarvisWakeWordEnabled') === 'true') {
    setTimeout(() => WakeWord.start(), 2000);
  }
});

