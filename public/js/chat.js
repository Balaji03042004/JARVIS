// ═══════════════════════════════════════════════
// JARVIS — Chat (render + send)
// ═══════════════════════════════════════════════

function parseContent(text) {
  let html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,'<em>$1</em>');

  // Code blocks
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const id = 'c_' + Math.random().toString(36).substr(2,6);
    return `<div class="code-header">
      <span class="code-lang-tag">${lang || 'CODE'}</span>
      <button class="copy-btn" onclick="copyCode('${id}')">COPY</button>
    </div><pre id="${id}">${code.trim()}</pre>`;
  });

  html = html.replace(/`([^`]+)`/g,'<code>$1</code>');
  html = html.replace(/\n/g,'<br>');
  return html;
}

function copyCode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const btn = document.querySelector(`[onclick="copyCode('${id}')"]`);
    if (btn) {
      btn.textContent = 'COPIED!'; btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 1800);
    }
  });
}

function addMessage(role, text) {
  _removeWelcome();
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const isAI = role === 'ai';
  div.innerHTML = `
    <div class="avatar ${role}">${isAI ? '⬡' : '▶'}</div>
    <div class="bubble ${role}">${isAI ? parseContent(text) : text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
  msgs.appendChild(div);
  scrollToBottom();
  if (isAI) speak(text);
  if (role === 'user') _appendHistory(text);
}

function addEnhancedMessage(role, text, sentiment, intent, entities) {
  _removeWelcome();
  const msgs = document.getElementById('messages');
  const div  = document.createElement('div');
  div.className = `msg ${role}`;
  const isAI = role === 'ai';

  // Build meta strip (sentiment + intent tags + feedback)
  let meta = '';
  if (isAI) {
    meta = `<div class="msg-meta">`;
    if (sentiment) meta += `<span class="sentiment-badge sentiment-${sentiment.type}">${sentiment.emoji} ${sentiment.label}</span>`;
    (intent || []).forEach(i => meta += `<span class="intent-tag">🎯 ${i.toUpperCase()}</span>`);
    meta += `<div class="feedback-group">
      <button class="feedback-btn" onclick="rateFeedback(this,1)" title="Helpful">👍</button>
      <button class="feedback-btn" onclick="rateFeedback(this,0)" title="Not helpful">👎</button>
    </div></div>`;
  }

  // Highlight entity names in content
  let content = parseContent(text);
  (entities || []).forEach(e => {
    const re = new RegExp(`\\b${e.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'g');
    content = content.replace(re, `<span class="entity-highlight" title="${e.type}">${e.text}</span>`);
  });

  div.innerHTML = `
    <div class="avatar ${role}">${isAI ? '⬡' : '▶'}</div>
    <div class="bubble ${role}">${content}${meta}</div>`;
  msgs.appendChild(div);
  scrollToBottom();
  if (isAI) speak(text);
  if (role === 'user') _appendHistory(text);
}

function addTypingIndicator() {
  const msgs = document.getElementById('messages');
  const div  = document.createElement('div');
  div.className = 'msg ai'; div.id = 'typing_ind';
  div.innerHTML = `<div class="avatar ai">⬡</div>
    <div class="bubble ai"><div class="typing"><span></span><span></span><span></span></div></div>`;
  msgs.appendChild(div);
  scrollToBottom();
}
function removeTypingIndicator() { const e = document.getElementById('typing_ind'); if (e) e.remove(); }

function _removeWelcome() {
  const w = document.getElementById('welcomeScreen');
  if (w) w.remove();
}
function _appendHistory(text) {
  const hist = document.getElementById('historyList');
  if (!hist) return;
  const placeholder = hist.querySelector('span');
  if (placeholder) hist.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'hist-item';
  d.textContent = text.substring(0, 26) + (text.length > 26 ? '…' : '');
  d.title = text;
  hist.appendChild(d);
}

// ── API Call ──
async function callJarvis(userMessage, extraSystemContext) {
  conversationHistory.push({ role: 'user', content: userMessage });

  // Show searching status if web search will likely be triggered
  if (detectSearchIntent(userMessage)) {
    setStatus('🔍 SEARCHING WEB...');
  }

  const systemPrompt = SYSTEM_PROMPTS[currentMode] + (extraSystemContext ? '\n\n' + extraSystemContext : '');

  // Detect emotion from message and include in request
  const emotionData = (typeof detectEmotion === 'function') ? detectEmotion(userMessage) : null;

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'X-Session-Id':   (typeof SESSION_ID !== 'undefined' ? SESSION_ID : '')
    },
    body: JSON.stringify({
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationHistory,
      userProfile,
      language: currentLanguage,
      isBoss: isVerifiedBoss,
      customInstructions,
      clientTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      documentIds: (typeof getDocumentIds === 'function' ? getDocumentIds() : []),
      emotionData
    })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `Server error ${response.status}`);
  }
  const data  = await response.json();
  const reply = data.content.map(b => b.text || '').join('');
  conversationHistory.push({ role: 'assistant', content: reply });
  return { reply, searchResults: data.searchResults || null };
}

// Detect if the user wants AI to reason about live news (as opposed to just showing headlines)
function _needsLiveNewsForAI(text) {
  const t = text.toLowerCase();
  return (/\b(tell me|summarize|explain|analyze|what do you think|your thoughts|discuss|opinion)\b/i.test(t) && /\b(news|headlines?|current events?|stories?)\b/i.test(t))
    || /\b(current events?|today.?s news|this week.?s news|recent developments?|morning brief)\b/i.test(t)
    || /\b(what.?s the (latest|current|recent)|what happened (today|this week|recently))\b/i.test(t);
}

// Detect if user message likely triggers a web search (mirrors server logic)
function detectSearchIntent(message) {
  const msg = message.trim();
  if (/^(search|find|look\s*up|google|web\s*search)\s*[:\s]/i.test(msg)) return true;
  if (/\b(search for|look up|find me|search the web|browse for)\b/i.test(msg)) return true;
  if (/\b(latest|current|recent|today|tonight|right now|live)\b.{0,30}\b(news|price|version|update|status|score|weather|result)\b/i.test(msg)) return true;
  if (/\b(news about|latest news|current events|breaking news|trending)\b/i.test(msg)) return true;
  if (/\b(price of|cost of|how much is|exchange rate|stock price|crypto price)\b/i.test(msg)) return true;
  return false;
}

// Append search source pills below the last AI message
function appendSearchSources(searchData) {
  if (!searchData || !searchData.results || !searchData.results.length) return;
  const msgs = document.getElementById('messages');
  const div  = document.createElement('div');
  div.className = 'search-sources';
  const items = searchData.results.slice(0, 4).map(r => {
    const domain = r.url ? r.url.replace(/^https?:\/\//, '').split('/')[0] : '';
    const href   = r.url ? `href="${r.url}" target="_blank" rel="noopener noreferrer"` : '';
    return `<a class="source-item" ${href}>
      <span class="source-title">${r.title}</span>
      ${domain ? `<span class="source-domain">${domain}</span>` : ''}
    </a>`;
  }).join('');
  div.innerHTML = `
    <div class="sources-header">
      <span class="sources-icon">🔍</span>
      <span class="sources-label">Web search · <em>${searchData.source}</em> · "${searchData.query}"</span>
    </div>
    <div class="sources-list">${items}</div>`;
  msgs.appendChild(div);
  scrollToBottom();
}

// ── Send Message ──
async function sendMessage() {
  const input = document.getElementById('userInput');
  const text  = input.value.trim();
  if (!text || isLoading) return;

  isLoading = true;
  document.getElementById('sendBtn').disabled = true;
  input.value = ''; input.style.height = 'auto';

  // ── Local command intercept: TOOLS PANEL (highest priority) ──
  if (typeof handleToolsCommand === 'function') {
    const toolsHandled = await handleToolsCommand(text);
    if (toolsHandled) {
      isLoading = false;
      document.getElementById('sendBtn').disabled = false;
      input.focus();
      return;
    }
  }

  // ── Local command intercept: system commands (open app / run cmd / sys info) ──
  if (typeof handleSystemCommand === 'function') {
    const sysHandled = await handleSystemCommand(text);
    if (sysHandled) {
      isLoading = false;
      document.getElementById('sendBtn').disabled = false;
      input.focus();
      return;
    }
  }

  // ── Local command intercept: voice change ──
  if (typeof handleVoiceCommand === 'function' && handleVoiceCommand(text)) {
    isLoading = false;
    document.getElementById('sendBtn').disabled = false;
    input.focus();
    return;
  }

  // ── Local command intercept: filesystem access ──
  if (typeof handleFilesystemCommand === 'function') {
    const fsHandled = await handleFilesystemCommand(text);
    if (fsHandled) {
      isLoading = false;
      document.getElementById('sendBtn').disabled = false;
      input.focus();
      return;
    }
  }

  // Analyze input
  const sent     = analyzeSentiment(text);
  const intent   = detectIntent(text);
  const entities = extractEntities(text);

  userProfile.stats.messages++;
  userProfile.stats.sentiment.push(sent.type === 'positive' ? 1 : sent.type === 'negative' ? -1 : 0);
  intent.forEach(i => userProfile.stats.topics.push(i));

  addMessage('user', text);
  addTypingIndicator();
  setStatus('🧠 PROCESSING...');

  try {
    // Inject live news context for AI when user asks about current events
    let _newsCtxForAI = null;
    if (typeof fetchNewsForAIContext === 'function' && typeof _needsLiveNewsForAI === 'function' && _needsLiveNewsForAI(text)) {
      try { _newsCtxForAI = await fetchNewsForAIContext(text); } catch {}
    }
    const { reply, searchResults } = await callJarvis(text, _newsCtxForAI);
    removeTypingIndicator();
    const rSent     = analyzeSentiment(reply);
    const rIntent   = detectIntent(reply);
    const rEntities = extractEntities(reply);
    addEnhancedMessage('ai', reply, rSent, rIntent, rEntities);
    if (searchResults) appendSearchSources(searchResults);
    saveProfile();
    updateContextBar();
    autoSaveConversation();
    setStatus('✓ SYSTEM ONLINE');
  } catch(err) {
    removeTypingIndicator();
    addMessage('ai', `⚠️ **Error**: ${err.message}\n\nMake sure your server is running: **node server.js**`);
    setStatus('ERROR', true);
  } finally {
    // Always reset loading state — even if an unexpected error escapes the catch
    isLoading = false;
    document.getElementById('sendBtn').disabled = false;
    input.focus();
  }
}
