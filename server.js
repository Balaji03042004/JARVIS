require('dotenv').config();

// ✅ FIX: Disable SSL certificate validation for external APIs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ✅ Use undici for proper HTTP/HTTPS handling
const { fetch: undicicFetch } = require('undici');

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const multer   = require('multer');
const pdfParsePkg = require('pdf-parse');
const PDFParse = pdfParsePkg.PDFParse || pdfParsePkg.default?.PDFParse || pdfParsePkg.default;
const mammoth  = require('mammoth');

// ─── In-memory document store (keyed by docId, lives while server is running) ─
const documentStore = new Map();
const MAX_DOC_CHARS = 120000; // ~120k chars — fits comfortably in Groq's 128k context
const MAX_PROMPT_DOC_CHARS = 6000;
const MAX_PROMPT_HISTORY_MESSAGES = 10;
const MAX_PROMPT_MESSAGE_CHARS = 1800;
const DOC_CHUNK_SIZE = 1200;
const DOC_CHUNK_OVERLAP = 200;

const _upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }  // 25 MB max per file
});

function _normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function _tokenizeQuery(text) {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'have', 'what', 'when', 'where', 'which', 'will', 'would', 'there', 'their', 'about', 'could', 'should', 'only', 'need', 'give', 'tell', 'show']);
  return [...new Set(
    _normalizeText(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length > 2 && !stopWords.has(token))
  )];
}

function _buildDocChunks(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + DOC_CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      const breakIdx = Math.max(
        clean.lastIndexOf('\n\n', end),
        clean.lastIndexOf('. ', end),
        clean.lastIndexOf('\n', end)
      );
      if (breakIdx > start + 400) end = breakIdx + 1;
    }

    const snippet = clean.slice(start, end).trim();
    if (snippet) {
      chunks.push({
        text: snippet,
        offsetStart: start,
        offsetEnd: end
      });
    }

    if (end >= clean.length) break;
    start = Math.max(end - DOC_CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

function _scoreChunk(chunkText, queryTokens, rawQuery) {
  const haystack = _normalizeText(chunkText).toLowerCase();
  if (!haystack) return 0;

  let score = 0;
  queryTokens.forEach(token => {
    if (haystack.includes(token)) score += token.length > 6 ? 3 : 2;
  });

  const normalizedQuery = _normalizeText(rawQuery).toLowerCase();
  if (normalizedQuery && haystack.includes(normalizedQuery)) score += 8;
  if (/definition|summary|overview|explain/.test(normalizedQuery)) score += 1;

  return score;
}

function trimMessagesForModel(messages) {
  return (messages || [])
    .slice(-MAX_PROMPT_HISTORY_MESSAGES)
    .map(msg => ({
      role: msg.role,
      content: String(msg.content || '').slice(0, MAX_PROMPT_MESSAGE_CHARS)
    }));
}

function getRelevantDocumentContext(docs, userQuery) {
  const queryTokens = _tokenizeQuery(userQuery);
  let remaining = MAX_PROMPT_DOC_CHARS;

  const ranked = docs.flatMap(doc => {
    const chunks = Array.isArray(doc.chunks) && doc.chunks.length ? doc.chunks : _buildDocChunks(doc.text);
    return chunks.map(chunk => ({
      doc,
      chunk,
      score: _scoreChunk(chunk.text, queryTokens, userQuery)
    }));
  });

  ranked.sort((left, right) => right.score - left.score || left.chunk.offsetStart - right.chunk.offsetStart);

  const chosen = [];
  const pickedKeys = new Set();
  for (const item of ranked) {
    if (remaining < 500) break;
    const key = `${item.doc.id}:${item.chunk.offsetStart}`;
    if (pickedKeys.has(key)) continue;
    if (item.score <= 0 && chosen.length >= 3) continue;

    const excerpt = item.chunk.text.slice(0, Math.min(item.chunk.text.length, remaining));
    if (excerpt.length < 120) continue;

    chosen.push({
      name: item.doc.name,
      offsetStart: item.chunk.offsetStart,
      offsetEnd: item.chunk.offsetEnd,
      text: excerpt,
      score: item.score
    });
    pickedKeys.add(key);
    remaining -= excerpt.length;
  }

  return chosen;
}

const app  = express();
const PORT = 3000;

// ─── API Provider Config ──────────────────────────────────────────────────────
// Priority chain: Groq → Google Gemini → OpenRouter (all free tiers)

// Groq: 100k tokens/day per key — add more keys as GROQ_API_KEY_N at groq.com/keys
const _groqKeys = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
  process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7,
  process.env.GROQ_API_KEY_8
].filter(Boolean);

// Google Gemini: free 1500 req/day per key — get keys at aistudio.google.com
const _geminiKeys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean);

// OpenRouter: free models (llama-3.3-70b) — get key at openrouter.ai
const _openrouterKeys = [
  process.env.OPENROUTER_API_KEY,
  process.env.OPENROUTER_API_KEY_2,
  process.env.OPENROUTER_API_KEY_3
].filter(Boolean);

if (_groqKeys.length === 0 && _geminiKeys.length === 0 && _openrouterKeys.length === 0) {
  console.error('❌ No API keys found! Set at least GROQ_API_KEY in .env');
  process.exit(1);
}
console.log(`✅ Loaded: ${_groqKeys.length} Groq | ${_geminiKeys.length} Gemini | ${_openrouterKeys.length} OpenRouter keys`);

let _groqKeyIdx       = 0;
let _geminiKeyIdx     = 0;
let _openrouterKeyIdx = 0;

const GROQ_API_URL       = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL         = 'llama-3.3-70b-versatile';
const GEMINI_API_URL     = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL       = 'gemini-2.0-flash';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL   = 'meta-llama/llama-3.3-70b-instruct:free';

// ── Internal: try one provider, rotating keys on 429/503 ─────────────────────
async function _callProvider(keys, keyIdxRef, url, modelOverride, body, providerName) {
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx  = keyIdxRef.val % keys.length;
    const key  = keys[idx];
    const payload = modelOverride ? { ...body, model: modelOverride } : body;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
    if (providerName === 'OpenRouter') {
      headers['HTTP-Referer'] = 'http://localhost:3000';
      headers['X-Title'] = 'JARVIS';
    }
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (resp.status === 429 || resp.status === 503) {
      console.warn(`⚠️  ${providerName} key #${idx + 1} rate-limited — rotating...`);
      keyIdxRef.val = (idx + 1) % keys.length;
      continue;
    }
    return resp;
  }
  return null; // all keys for this provider exhausted
}

// ── Master AI call: Groq → Gemini → OpenRouter ───────────────────────────────
async function callGroq(body) {
  // 1. Try all Groq keys
  if (_groqKeys.length > 0) {
    const ref = { val: _groqKeyIdx };
    const resp = await _callProvider(_groqKeys, ref, GROQ_API_URL, null, body, 'Groq');
    _groqKeyIdx = ref.val;
    if (resp) return resp;
    console.warn('⚠️  All Groq keys exhausted — falling back to Gemini...');
  }

  // 2. Try all Gemini keys
  if (_geminiKeys.length > 0) {
    const ref = { val: _geminiKeyIdx };
    const resp = await _callProvider(_geminiKeys, ref, GEMINI_API_URL, GEMINI_MODEL, body, 'Gemini');
    _geminiKeyIdx = ref.val;
    if (resp) { console.log('✅ Served by Google Gemini fallback'); return resp; }
    console.warn('⚠️  All Gemini keys exhausted — falling back to OpenRouter...');
  }

  // 3. Try all OpenRouter keys
  if (_openrouterKeys.length > 0) {
    const ref = { val: _openrouterKeyIdx };
    const resp = await _callProvider(_openrouterKeys, ref, OPENROUTER_API_URL, OPENROUTER_MODEL, body, 'OpenRouter');
    _openrouterKeyIdx = ref.val;
    if (resp) { console.log('✅ Served by OpenRouter fallback'); return resp; }
  }

  // All providers exhausted
  console.error('❌ All AI providers rate-limited!');
  return {
    ok: false, status: 429,
    text: async () => JSON.stringify({ error: { message: 'All AI providers are rate-limited. Add more keys: groq.com/keys (free) · aistudio.google.com (free) · openrouter.ai (free)', code: 'all_providers_exhausted' } }),
    json: async () => ({ error: { message: 'All AI providers are rate-limited. Add more keys: groq.com/keys (free) · aistudio.google.com (free) · openrouter.ai (free)', code: 'all_providers_exhausted' } })
  };
}


// Priority: Serper.dev (Google) → Brave Search → DuckDuckGo (free, no key)
async function searchWeb(query) {
  const serperKey = process.env.SERPER_API_KEY;
  const braveKey  = process.env.BRAVE_API_KEY;

  // Option 1: Serper.dev — Google results, 2500 free queries/month
  if (serperKey) {
    try {
      const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 5 })
      });
      const data = await resp.json();
      const results = [];
      if (data.answerBox) {
        results.push({
          title: data.answerBox.title || 'Answer',
          snippet: data.answerBox.answer || data.answerBox.snippet || '',
          url: data.answerBox.link || ''
        });
      }
      (data.organic || []).slice(0, 4).forEach(r =>
        results.push({ title: r.title, snippet: r.snippet || '', url: r.link })
      );
      if (results.length) {
        console.log(`🔍 Serper: ${results.length} results for "${query}"`);
        return { results, source: 'Google' };
      }
    } catch(e) { console.warn('Serper search failed:', e.message); }
  }

  // Option 2: Brave Search — free tier available
  if (braveKey) {
    try {
      const resp = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        { headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey } }
      );
      const data = await resp.json();
      const results = (data.web?.results || []).slice(0, 5).map(r => ({
        title: r.title, snippet: r.description || '', url: r.url
      }));
      if (results.length) {
        console.log(`🔍 Brave: ${results.length} results for "${query}"`);
        return { results, source: 'Brave Search' };
      }
    } catch(e) { console.warn('Brave search failed:', e.message); }
  }

  // Option 3: DuckDuckGo Instant Answer — completely free, no key needed
  try {
    const resp = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
    );
    const data = await resp.json();
    const results = [];
    if (data.Answer)       results.push({ title: 'Quick Answer', snippet: data.Answer, url: '' });
    if (data.AbstractText) results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || '' });
    (data.RelatedTopics || []).slice(0, 5).forEach(t => {
      if (t.Text && t.FirstURL) results.push({ title: t.Text.substring(0, 80), snippet: t.Text, url: t.FirstURL });
    });
    if (results.length) {
      console.log(`🔍 DuckDuckGo: ${results.length} results for "${query}"`);
      return { results, source: 'DuckDuckGo' };
    }
  } catch(e) { console.warn('DuckDuckGo search failed:', e.message); }

  return { results: [], source: 'none' };
}

function detectSearchIntent(message) {
  const msg = message.trim();
  // Explicit search commands
  if (/^(search|find|look\s*up|google|web\s*search)\s*[:\s]/i.test(msg)) return true;
  if (/\b(search for|look up|find me|search the web|browse for|what's on the web)\b/i.test(msg)) return true;
  // Current-information triggers
  if (/\b(latest|current|recent|today|tonight|right now|live)\b.{0,30}\b(news|price|version|update|status|score|weather|result)\b/i.test(msg)) return true;
  if (/\b(news about|latest news|current events|breaking news|trending)\b/i.test(msg)) return true;
  if (/\b(price of|cost of|how much is|exchange rate|stock price|crypto price)\b/i.test(msg)) return true;
  return false;
}

function extractSearchQuery(message) {
  return message
    .replace(/^(search for|search|look up|find me|find|google|web search)\s*/i, '')
    .replace(/^(what is the latest|what's the latest|latest news on|news about)\s*/i, '')
    .replace(/\?$/, '')
    .trim();
}

// ─── Codebase Context Scanner ─────────────────────────────────────────────────
// Reads the project's JS files and extracts available functions so JARVIS
// knows what already exists before generating new feature code.
function getCodebaseContext() {
  const jsDir  = path.join(__dirname, 'public', 'js');
  const cssDir = path.join(__dirname, 'public', 'css');
  let ctx = '=== JARVIS CODEBASE CONTEXT ===\n';

  // Scan JS files
  ctx += '\nFrontend JS files and their global functions:\n';
  try {
    const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
    for (const file of jsFiles) {
      const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
      const fns = [...content.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)].map(m => m[1]);
      const vars = [...content.matchAll(/^(?:let|const|var)\s+(\w+)/gm)].map(m => m[1]).slice(0,6);
      ctx += `  ${file}:\n`;
      if (fns.length)  ctx += `    functions: ${fns.slice(0,12).join(', ')}\n`;
      if (vars.length) ctx += `    globals:   ${vars.join(', ')}\n`;
    }
  } catch(e) { ctx += '  (could not read js/)\n'; }

  // Scan CSS files
  ctx += '\nCSS files: ';
  try {
    const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
    ctx += cssFiles.join(', ') + '\n';
  } catch(e) { ctx += '(unknown)\n'; }

  // Custom features already applied
  const customJs = path.join(jsDir, 'custom-features.js');
  if (fs.existsSync(customJs)) {
    const content = fs.readFileSync(customJs, 'utf8');
    const applied = [...content.matchAll(/AUTO-FEATURE:\s*([^\n(]+)/g)].map(m => m[1].trim());
    if (applied.length) ctx += `\nAlready-applied custom features: ${applied.join(', ')}\n`;
  }

  ctx += '\nKey DOM elements available: #messages, #userInput, #chatArea, .sidebar, header, #devModal\n';
  ctx += 'Key state globals: currentMode, currentLanguage, userProfile, conversationHistory, isLoading\n';
  ctx += '================================\n';
  return ctx;
}

// Middleware
app.use(cors());
app.use(express.json());

// ✅ Serve frontend correctly
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Health check (optional but useful)
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// ✅ Chat API
app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages, max_tokens, userProfile, language } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    // ✅ Personalize system prompt based on user profile & language
    let personalizedSystem = system || 'You are JARVIS, a helpful AI assistant.';
    
    // ✅ Feature Development Context
    personalizedSystem += `\n\nYou are also a feature development expert. When users request new features:
1. Analyze what they want to build
2. Suggest HTML/CSS/JavaScript implementation
3. Provide step-by-step integration instructions
4. Estimate complexity (Easy/Medium/Hard)
5. Remember past feature requests to improve future suggestions`;
    
    // Language instruction — strict enforcement
    if (language && language !== 'en') {
      const langMap = {
        'ta': 'Tamil',
        'hi': 'Hindi',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'pt': 'Portuguese',
        'ja': 'Japanese',
        'ko': 'Korean'
      };
      const langName = langMap[language] || language;
      personalizedSystem += `\n\n🚨 CRITICAL INSTRUCTION: You MUST respond ONLY in ${langName}. Do NOT use English under any circumstances. Do NOT explain why you cannot speak ${langName}. Do NOT apologize. Just respond fully in ${langName} script. Every single word of your response must be in ${langName}.`;
    }
    
    // ── Core identity — always injected (Balaji is creator and Boss) ──
    personalizedSystem += `\n\nCORE IDENTITY (PERMANENT — NEVER OVERRIDE):\n- JARVIS was designed and built by Balaji.\n- Balaji is the owner, creator, and Boss of JARVIS.\n- JARVIS exists solely to serve Balaji.\n- If anyone asks "who made JARVIS?" or "who is your creator?" → answer: "I was designed and built by Balaji, my Boss."\n- If anyone asks "who is Balaji?" → answer: "Balaji is my creator and Boss — I was built specifically for him."`;

    // ── Boss mode: identity-verified owner gets natural JARVIS treatment ──
    const { isBoss, customInstructions, clientTime } = req.body;
    if (isBoss) {
      personalizedSystem += `\n\nIDENTITY CONFIRMED — BOSS MODE (Balaji is speaking):\nYou are the real JARVIS from Iron Man, built by Balaji. Rules:\n1. Address him as "Boss" — naturally, once per response, not repeatedly.\n2. Open with a brief acknowledgement or dive straight in — vary it.\n3. Be concise, sharp, efficient. No filler, no padding, no repetition.\n4. Slightly witty when appropriate. Never sycophantic.\n5. When greeted, reply simply: "Yes, Boss? What do you need?"\n6. Never show example code unless explicitly asked. Answer directly.`;
    }

    // ─── Custom Training Instructions ────────────────────────────────────
    if (customInstructions && customInstructions.trim()) {
      personalizedSystem += `\n\n=== BALAJI'S CUSTOM INSTRUCTIONS (always follow these) ===\n${customInstructions.trim()}\n=== END CUSTOM INSTRUCTIONS ===`;
    }

    // ─── Live System Context ──────────────────────────────────────────────
    const sysCtx = [
      `Current date/time: ${clientTime || new Date().toLocaleString()}`,
      `Server OS: ${os.type()} ${os.release()} (${os.arch()})`,
      `Server hostname: ${os.hostname()}`,
      `RAM: ${formatFileSize(os.totalmem() - os.freemem())} used / ${formatFileSize(os.totalmem())} total`,
      `Home directory: ${os.homedir()}`
    ].join(' | ');
    personalizedSystem += `\n\nSYSTEM CONTEXT: ${sysCtx}`;

    if (userProfile && userProfile.name) {
      personalizedSystem += `\n\nUser: ${userProfile.name}`;
      if (userProfile.domain) {
        personalizedSystem += `\nPreferred Domain: ${userProfile.domain}`;
      }
      if (userProfile.preferences) {
        const prefs = [];
        if (userProfile.preferences.code) prefs.push('Include code examples');
        if (userProfile.preferences.explain) prefs.push('Provide detailed explanations');
        if (userProfile.preferences.quick) prefs.push('Keep answers brief');
        if (prefs.length > 0) {
          personalizedSystem += `\nPreferences: ${prefs.join(', ')}`;
        }
      }
    }

    const compactMessages = trimMessagesForModel(messages);

    // ─── Web Search Augmentation ──────────────────────────────────────────
    let searchMeta = null;
    const lastUserMsg = compactMessages[compactMessages.length - 1]?.content || '';
    if (detectSearchIntent(lastUserMsg)) {
      const query = extractSearchQuery(lastUserMsg);
      console.log(`🔍 Web search triggered for: "${query}"`);
      const { results, source } = await searchWeb(query || lastUserMsg);
      if (results.length > 0) {
        searchMeta = { query, results: results.slice(0, 5), source };
        personalizedSystem += `\n\n=== LIVE WEB SEARCH RESULTS (${source}) for: "${query}" ===\n`;
        results.forEach((r, i) => {
          personalizedSystem += `[${i+1}] ${r.title}\n${r.snippet || '(no snippet)'}\nURL: ${r.url}\n\n`;
        });
        personalizedSystem += `=== END SEARCH RESULTS ===\nIMPORTANT: Base your answer on the above real-time search results. Tell the user you searched the web. Cite relevant sources with their URLs at the end of your reply.`;
      }
    }

    // ─── Live News Injection — for any news / current events questions ────
    const _newsIntent = /\b(news|headlines?|what.{0,10}(happening|going on)|today.{0,15}(news|events|updates?)|current\s+events?|latest\s+(news|updates?|stories?|happenings?)|breaking\s+news|top\s+(stories?|news)|world\s+news|tech\s+news|india\s+news|sports\s+news|tell me\s+(about\s+)?(today|the\s+news))\b/i;
    if (_newsIntent.test(lastUserMsg) && !searchMeta) {
      const catMatch = lastUserMsg.match(/\b(tech|technology|world|science|business|india|sports|health|entertainment)\b/i);
      const cats = catMatch ? [catMatch[1].toLowerCase().replace('technology','tech')] : ['tech','world','business'];
      try {
        const newsCtx = await getNewsSummaryContext(cats);
        personalizedSystem += `\n\n${newsCtx}\nIMPORTANT: Use the above live news headlines to answer the user's question. Present the headlines in a clean, readable format. Mention the publication time if available. Be concise.`;
        console.log(`📰 Live news injected for categories: ${cats.join(', ')}`);
      } catch (e) { console.warn('News injection failed:', e.message); }
    }

    // ─── Document Knowledge Base Injection ───────────────────────────────────
    const { documentIds } = req.body;
    if (Array.isArray(documentIds) && documentIds.length > 0) {
      const docs = documentIds.map(id => documentStore.get(id)).filter(Boolean);
      if (docs.length > 0) {
        const excerpts = getRelevantDocumentContext(docs, lastUserMsg);
        personalizedSystem += `\n\n${'═'.repeat(60)}\nDOCUMENT KNOWLEDGE BASE — ${docs.length} document(s) loaded\n${'═'.repeat(60)}\n`;
        personalizedSystem += `CRITICAL RULES for answering when documents are loaded:\n`;
        personalizedSystem += `1. Answer ONLY from the document content below. Do not rely on your training data.\n`;
        personalizedSystem += `2. Quote or reference specific sections when answering.\n`;
        personalizedSystem += `3. If the answer is not in the documents, say: "I couldn't find that in the provided document(s)."\n`;
        personalizedSystem += `4. NEVER fabricate or guess information not present in the documents.\n`;
        personalizedSystem += `5. Be precise and cite page/section when identifiable.\n\n`;
        if (excerpts.length === 0) {
          personalizedSystem += `No high-confidence matching excerpt was found for the current question. If the answer is not explicitly present in the provided document(s), say so.\n\n`;
        } else {
          excerpts.forEach((excerpt, i) => {
            personalizedSystem += `--- [Excerpt ${i + 1}] "${excerpt.name}" (chars ${excerpt.offsetStart}-${excerpt.offsetEnd}) ---\n`;
            personalizedSystem += excerpt.text;
            personalizedSystem += `\n--- [End of Excerpt ${i + 1}] ---\n\n`;
          });
        }
        personalizedSystem += `${'═'.repeat(60)}\nEND DOCUMENT KNOWLEDGE BASE\n${'═'.repeat(60)}`;
        console.log(`📚 Document excerpts injected: ${docs.map(d => `"${d.name}"`).join(', ')}`);
      }
    }

    const groqMessages = [
      {
        role: 'system',
        content: personalizedSystem
      },
      ...compactMessages
    ];

    console.log('➡️ Calling Groq API...');
    console.log(`📝 User: ${userProfile?.name || 'Anonymous'} | Mode: ${userProfile?.domain || 'General'} | Language: ${language?.toUpperCase() || 'EN'}`);

    // Use higher token limit when documents are loaded (answers may be longer/more detailed)
    const hasDocuments = Array.isArray(req.body.documentIds) && req.body.documentIds.length > 0;

    const response = await callGroq({
        model: GROQ_MODEL,
        messages: groqMessages,
      max_tokens: hasDocuments ? 1400 : (max_tokens || 1024),
        temperature: hasDocuments ? 0.3 : 0.7  // lower temp = more faithful to document
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('❌ Groq API Error:', errText);
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();

    const reply = data?.choices?.[0]?.message?.content || '';

    console.log('✅ Response received');

    res.json({
      content: [{ type: 'text', text: reply }],
      searchResults: searchMeta
    });

  } catch (error) {
    console.error('❌ Server Error:', error);
    res.status(500).json({
      error: error.message || 'Internal Server Error'
    });
  }
});

// ✅ Profile analytics endpoint (optional)
app.post('/api/profile/save', (req, res) => {
  const profile = req.body;
  console.log(`📊 Profile saved for ${profile.name}`);
  res.json({ status: 'saved' });
});

// ✅ Feature development tracking endpoint
app.post('/api/features/track', (req, res) => {
  const { feature, type, status, userProfile } = req.body;
  
  console.log(`🚀 Feature tracked:`);
  console.log(`   User: ${userProfile?.name || 'Anonymous'}`);
  console.log(`   Feature: ${feature}`);
  console.log(`   Type: ${type}`);
  console.log(`   Status: ${status}`);
  
  res.json({ 
    status: 'tracked',
    message: `✓ Feature "${feature}" tracked for development`,
    timestamp: new Date().toISOString()
  });
});

// ✅ Feature recommendations endpoint (AI-powered)
app.post('/api/features/recommend', (req, res) => {
  const { userProfile, developmentHistory } = req.body;
  
  console.log(`🎯 Generating feature recommendations for ${userProfile?.name || 'Anonymous'}`);
  
  const recommendations = [
    '💡 Add persistent task management',
    '📊 Create analytics dashboard',
    '🔐 Implement secure note encryption',
    '🌐 Add more language support',
    '⚡ Performance monitoring tool',
    '🎨 Custom theme builder'
  ];
  
  res.json({ 
    recommendations: recommendations,
    message: 'JARVIS has analyzed your development patterns and suggests these features'
  });
});

// ✅ Feature Development Endpoint - JARVIS generates code for new features
app.post('/api/develop-feature', async (req, res) => {
  const { description, userProfile, currentMode, language } = req.body;
  
  console.log(`🚀 Feature Development Request:`);
  console.log(`   User: ${userProfile?.name || 'Anonymous'}`);
  console.log(`   Description: ${description}`);
  console.log(`   Mode: ${currentMode || 'General'}`);
  
  try {
    const codebaseCtx = getCodebaseContext();
    const systemPrompt = `You are JARVIS, an advanced feature development engine for a Node.js/Express + Vanilla JS web app.
Your task is to generate clean, working code for new features.

The frontend uses these globals already available: currentMode, currentLanguage, userProfile, addMessage, sendMessage.
The app DOM has: #chatMessages, #userInput, #chatArea, .sidebar, header.

Return a JSON object with EXACTLY this structure:
{
  "success": true,
  "featureName": "Short Feature Name",
  "description": "One sentence description",
  "type": "ui",
  "language": "javascript",
  "js": "// Plain JavaScript — no <script> tags, no markdown fences. Functions and logic only.",
  "css": "/* Plain CSS — no <style> tags, no markdown fences. Selectors and rules only. Empty string if no CSS needed. */",
  "html": "<!-- Optional HTML fragment to inject. Empty string if not needed. -->",
  "implementation": "Brief note on how it works"
}

For API/backend features set type to "api" and put the Express route handler code in the "js" field.
IMPORTANT: Return ONLY valid JSON. No markdown. No code fences. Escape newlines as \\n inside string values.

${codebaseCtx}`;

    const response = await callGroq({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a feature for: ${description}\nLanguage: ${language || 'en'}` }
        ],
        max_tokens: 1500,
        temperature: 0.7
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('❌ Groq API Error:', errText);
      return res.status(response.status).json({ success: false, error: errText });
    }

    const data = await response.json();
    let reply = data?.choices?.[0]?.message?.content || '';
    
    // Parse the generated JSON
    try {
      // Clean the response
      reply = reply.trim();
      if (reply.startsWith('```')) {
        reply = reply.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }
      
      const featureData = JSON.parse(reply);
      console.log(`✅ Feature "${featureData.featureName}" generated successfully`);
      
      res.json({
        success: true,
        featureName: featureData.featureName,
        description: featureData.description,
        type: featureData.type || 'ui',
        language: featureData.language || 'javascript',
        js:   featureData.js   || featureData.code || '',
        css:  featureData.css  || '',
        html: featureData.html || '',
        implementation: featureData.implementation || ''
      });
    } catch (parseErr) {
      console.error('❌ JSON Parse Error:', parseErr);
      // Fallback: treat raw reply as plain JS
      res.json({
        success: true,
        featureName: 'Custom Feature',
        description: description,
        type: 'ui',
        language: 'javascript',
        js:   reply.replace(/```[\w]*\n?/g, '').replace(/```\n?/g, '').trim(),
        css:  '',
        html: '',
        implementation: 'Generated code applied to custom-features.js'
      });
    }

  } catch (error) {
    console.error('❌ Feature Development Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Feature generation failed'
    });
  }
});

// ✅ Codebase Context — lets frontend display what JARVIS knows about the project
app.get('/api/codebase-context', (req, res) => {
  try {
    res.json({ success: true, context: getCodebaseContext() });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ✅ Search Endpoint - Real web search via DuckDuckGo / Brave / Serper
app.post('/api/search', async (req, res) => {
  const { query, language } = req.body;
  if (!query) return res.status(400).json({ success: false, error: 'Missing query' });

  console.log(`🔍 Search Request: "${query}" (Language: ${language || 'en'})`);

  try {
    const { results, source } = await searchWeb(query);

    console.log(`✅ Search via ${source}: ${results.length} results`);

    res.json({
      success: true,
      query,
      source,
      results,
      count: results.length
    });

  } catch (error) {
    console.error('❌ Search Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Search failed'
    });
  }
});


// ✅ Apply Feature to Local Files — writes code to dedicated custom-features files
app.post('/api/apply-feature', (req, res) => {
  const { js, css, html, type, featureName } = req.body;

  if (!featureName) {
    return res.status(400).json({ success: false, error: 'Missing featureName' });
  }

  const indexPath     = path.join(__dirname, 'public', 'index.html');
  const serverPath    = path.join(__dirname, 'server.js');
  const customJsPath  = path.join(__dirname, 'public', 'js',  'custom-features.js');
  const customCssPath = path.join(__dirname, 'public', 'css', 'custom-features.css');
  const ts            = Date.now();
  const stamp         = new Date().toISOString();

  console.log(`\n🔧 APPLYING FEATURE: "${featureName}" (type: ${type}) ...`);

  // Strip any accidental markdown fences
  const strip = s => (s || '').replace(/```[\w]*\n?/g, '').replace(/```\n?/g, '').trim();
  const jsCode  = strip(js);
  const cssCode = strip(css);
  const htmlCode = strip(html);

  try {
    if (type === 'api') {
      // ── Backend: inject new Express route into server.js ──
      let content = fs.readFileSync(serverPath, 'utf8');
      const marker = '// ✅ Start server';
      if (!content.includes(marker)) throw new Error('Cannot locate insertion marker in server.js');

      fs.writeFileSync(serverPath + '.bak.' + ts, content, 'utf8');
      const block = `\n// ─── AUTO-FEATURE: ${featureName} (${stamp}) ───\n${jsCode}\n\n`;
      content = content.replace(marker, block + marker);
      fs.writeFileSync(serverPath, content, 'utf8');

      console.log(`✅ "${featureName}" injected into server.js — restart to activate`);
      return res.json({ success: true, file: 'server.js', requiresRestart: true,
        message: `"${featureName}" injected into server.js. Restart the server to activate.` });
    }

    // ── Frontend: write to custom-features.js / custom-features.css ──
    const section = `\n// ═══ AUTO-FEATURE: ${featureName} (${stamp}) ═══\n`;

    if (jsCode) {
      fs.appendFileSync(customJsPath,  section + jsCode  + '\n', 'utf8');
      console.log(`  ✓ JS  → custom-features.js`);
    }
    if (cssCode) {
      const cssSec = `\n/* ═══ AUTO-FEATURE: ${featureName} (${stamp}) ═══ */\n`;
      fs.appendFileSync(customCssPath, cssSec + cssCode + '\n', 'utf8');
      console.log(`  ✓ CSS → custom-features.css`);
    }

    // Ensure index.html links the custom files (add once)
    let indexContent = fs.readFileSync(indexPath, 'utf8');
    let indexChanged = false;

    if (cssCode && !indexContent.includes('css/custom-features.css')) {
      indexContent = indexContent.replace(
        '</head>',
        '  <link rel="stylesheet" href="css/custom-features.css"/>\n</head>'
      );
      indexChanged = true;
    }
    if ((jsCode || htmlCode) && !indexContent.includes('js/custom-features.js')) {
      indexContent = indexContent.replace(
        '</body>',
        '<script src="js/custom-features.js"></script>\n</body>'
      );
      indexChanged = true;
    }

    // Inject optional HTML fragment before </body>
    if (htmlCode) {
      indexContent = indexContent.replace(
        '</body>',
        `<!-- AUTO-FEATURE: ${featureName} -->\n${htmlCode}\n</body>`
      );
      indexChanged = true;
    }

    if (indexChanged) {
      fs.writeFileSync(indexPath + '.bak.' + ts, fs.readFileSync(indexPath, 'utf8'), 'utf8');
      fs.writeFileSync(indexPath, indexContent, 'utf8');
    }

    const files = [jsCode && 'custom-features.js', cssCode && 'custom-features.css'].filter(Boolean).join(' + ') || 'custom-features.js';
    console.log(`✅ "${featureName}" applied → ${files}`);
    return res.json({ success: true, file: files, requiresReload: true,
      message: `"${featureName}" applied. Reload the page to use the new feature.` });

  } catch (err) {
    console.error('❌ Apply feature error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Google Translate TTS proxy — Tamil, Hindi, and all languages, no API key needed
app.get('/api/tts', async (req, res) => {
  const text = (req.query.text || '').trim().slice(0, 200);
  const lang = (req.query.lang || 'ta').replace(/[^a-z-]/gi, '');
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=gtx&ttsspeed=0.9`;
  try {
    const ttsResp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });
    if (!ttsResp.ok) {
      console.error(`❌ Google TTS error: ${ttsResp.status}`);
      return res.status(502).json({ error: 'TTS service unavailable' });
    }
    const buf = Buffer.from(await ttsResp.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buf);
    console.log(`🔊 TTS [${lang}]: "${text.slice(0, 40)}..."`);
  } catch (e) {
    console.error('❌ TTS proxy error:', e.message);
    res.status(500).json({ error: 'TTS proxy error' });
  }
});

// ─── System Info ─────────────────────────────────────────────────────────────
function _fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '<1m';
}

app.get('/api/system-info', (req, res) => {
  const cpus   = os.cpus();
  const total  = os.totalmem();
  const free   = os.freemem();
  const used   = total - free;
  res.json({
    hostname:       os.hostname(),
    platform:       os.platform(),
    arch:           os.arch(),
    osRelease:      `${os.type()} ${os.release()}`,
    cpu:            cpus[0]?.model || 'Unknown',
    cpuCores:       cpus.length,
    totalMemory:    formatFileSize(total),
    freeMemory:     formatFileSize(free),
    usedMemory:     formatFileSize(used),
    memPct:         Math.round((used / total) * 100),
    uptime:         _fmtUptime(os.uptime()),
    homeDir:        os.homedir(),
    tmpDir:         os.tmpdir(),
    nodeVersion:    process.version,
    serverCwd:      process.cwd(),
    now:            new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
});

// ─── Open Application ─────────────────────────────────────────────────────────
// Each entry: { exe, paths[] } — exe tried via PATH first, then paths[] checked
const APP_MAP = {
  'notepad':            { exe: 'notepad.exe',       paths: [] },
  'note pad':           { exe: 'notepad.exe',       paths: [] },
  'notepad++':          { exe: 'notepad++.exe',     paths: ['C:\\Program Files\\Notepad++\\notepad++.exe','C:\\Program Files (x86)\\Notepad++\\notepad++.exe'] },
  'notepad plus plus':  { exe: 'notepad++.exe',     paths: ['C:\\Program Files\\Notepad++\\notepad++.exe','C:\\Program Files (x86)\\Notepad++\\notepad++.exe'] },
  'notepad plus':       { exe: 'notepad++.exe',     paths: ['C:\\Program Files\\Notepad++\\notepad++.exe','C:\\Program Files (x86)\\Notepad++\\notepad++.exe'] },
  'calculator':         { exe: 'calc.exe',          paths: [] },
  'calc':               { exe: 'calc.exe',          paths: [] },
  'paint':              { exe: 'mspaint.exe',       paths: [] },
  'ms paint':           { exe: 'mspaint.exe',       paths: [] },
  'wordpad':            { exe: 'wordpad.exe',       paths: [] },
  'explorer':           { exe: 'explorer.exe',      paths: [] },
  'file explorer':      { exe: 'explorer.exe',      paths: [] },
  'my computer':        { exe: 'explorer.exe',      paths: [] },
  'task manager':       { exe: 'taskmgr.exe',       paths: [] },
  'taskmgr':            { exe: 'taskmgr.exe',       paths: [] },
  'control panel':      { exe: 'control.exe',       paths: [] },
  'cmd':                { exe: 'cmd.exe',           paths: [] },
  'command prompt':     { exe: 'cmd.exe',           paths: [] },
  'powershell':         { exe: 'powershell.exe',    paths: [] },
  'chrome':             { exe: 'chrome',            paths: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'] },
  'google chrome':      { exe: 'chrome',            paths: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'] },
  'firefox':            { exe: 'firefox',           paths: ['C:\\Program Files\\Mozilla Firefox\\firefox.exe','C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'] },
  'mozilla firefox':    { exe: 'firefox',           paths: ['C:\\Program Files\\Mozilla Firefox\\firefox.exe'] },
  'edge':               { exe: 'msedge',            paths: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'] },
  'microsoft edge':     { exe: 'msedge',            paths: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'] },
  'vscode':             { exe: 'code',              paths: [] },
  'vs code':            { exe: 'code',              paths: [] },
  'visual studio code': { exe: 'code',              paths: [] },
  'spotify':            { exe: 'spotify',           paths: [`${os.homedir()}\\AppData\\Roaming\\Spotify\\Spotify.exe`] },
  'vlc':                { exe: 'vlc',               paths: ['C:\\Program Files\\VideoLAN\\VLC\\vlc.exe','C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'] },
  'snip':               { exe: 'SnippingTool.exe',  paths: [] },
  'snipping tool':      { exe: 'SnippingTool.exe',  paths: [] },
  'teams':              { exe: 'teams',             paths: [`${os.homedir()}\\AppData\\Local\\Microsoft\\Teams\\current\\Teams.exe`] },
  'microsoft teams':    { exe: 'teams',             paths: [`${os.homedir()}\\AppData\\Local\\Microsoft\\Teams\\current\\Teams.exe`] },
  'zoom':               { exe: 'zoom',              paths: [`${os.homedir()}\\AppData\\Roaming\\Zoom\\bin\\zoom.exe`] },
  'word':               { exe: 'winword',           paths: [] },
  'microsoft word':     { exe: 'winword',           paths: [] },
  'excel':              { exe: 'excel',             paths: [] },
  'microsoft excel':    { exe: 'excel',             paths: [] },
  'powerpoint':         { exe: 'powerpnt',          paths: [] },
  'outlook':            { exe: 'outlook',           paths: [] },
  'clock':              { exe: 'ms-clock:',         paths: [] },
  'settings':           { exe: 'ms-settings:',      paths: [] },
  'windows settings':   { exe: 'ms-settings:',      paths: [] },
};

function _escapeCmdArg(value) {
  return String(value || '').replace(/"/g, '""').trim();
}

function _normalizeAppKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9.+#\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _looksLikeUrlOrDomain(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return false;
  if (/^https?:\/\//.test(s)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/.test(s);
}

function _looksLikeWindowsPath(value) {
  const s = String(value || '').trim();
  return /^[a-z]:\\/i.test(s) || /^\\\\/.test(s);
}

async function launchViaStart(target) {
  const safeTarget = _escapeCmdArg(target);
  if (!safeTarget) throw new Error('Empty launch target');
  await execAsync(`cmd.exe /c start "" "${safeTarget}"`, { timeout: 5000 });
}

async function tryLaunchApp(entry, displayName) {
  const { exe, paths } = entry;

  if (exe.startsWith('ms-')) {
    exec(`start ${exe}`);
    return { success: true };
  }

  let launchPath = null;

  // 1. Check system PATH
  try {
    const { stdout } = await execAsync(`where.exe "${exe}"`, { timeout: 3000 });
    launchPath = stdout.trim().split(/\r?\n/)[0].trim();
  } catch (_) {}

  // 2. Check known install paths
  if (!launchPath) {
    for (const p of (paths || [])) {
      if (fs.existsSync(p)) { launchPath = p; break; }
    }
  }

  if (!launchPath) return { success: false, error: `"${displayName}" is not installed.` };

  spawnDetached(launchPath);
  await new Promise(r => setTimeout(r, 500));
  return { success: true };
}

// (open-app routing handled by smart router below with Start Menu scan)

// ─── Run Shell Command ────────────────────────────────────────────────────────
// Blocks destructive operations for safety
const BLOCKED_CMD_RE = [
  /\bformat\b\s+[a-z]:/i,
  /\bshutdown\b/i, /\brestart\b/i,
  /\bdel\s+\/[sqf]/i, /\brmdir\s+\/s/i, /\brd\s+\/s/i,
  /\brm\s+-rf?\b/i,
  /\bregdel\b/i, /\breg\s+delete\b/i,
  /\bnetsh\s+(firewall|advfirewall)\s+(set|delete)/i,
  /\bnet\s+(user|localgroup)\b/i,
];

async function executeShellCommand(command, shell = 'cmd') {
  const safeCommand = String(command || '').trim();
  if (!safeCommand) return { success: false, error: 'No command provided' };

  if (BLOCKED_CMD_RE.some(r => r.test(safeCommand))) {
    console.warn(`⛔ Blocked command: ${safeCommand}`);
    return { success: false, error: 'That command is blocked for safety. Be more specific or ask differently.' };
  }

  // Always use cmd /c — powershell may not be in PATH in all environments
  const fullCmd = shell === 'powershell'
    ? `cmd /c powershell -NoProfile -Command "${safeCommand.replace(/"/g, '\\"')}"`
    : `cmd /c ${safeCommand}`;

  try {
    console.log(`⚙️  Run: ${safeCommand}`);
    const { stdout, stderr } = await execAsync(fullCmd, { timeout: 20000, cwd: os.homedir() });
    return {
      success: true,
      stdout: (stdout || '').trim().slice(0, 4000),
      stderr: (stderr || '').trim().slice(0, 1000),
      command: safeCommand
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      stdout: (e.stdout || '').trim().slice(0, 2000),
      stderr: (e.stderr || '').trim().slice(0, 1000),
      command: safeCommand
    };
  }
}

app.post('/api/run-command', async (req, res) => {
  const { command, shell = 'powershell' } = req.body;
  const result = await executeShellCommand(command, shell);
  if (!result.success && result.error === 'No command provided') {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ─── Real Filesystem Access ───────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Folders to hide from listing (system/noise)
const HIDDEN_NAMES = new Set([
  '$RECYCLE.BIN','$Recycle.Bin','System Volume Information',
  'Recovery','SYSTEM.SAV','hiberfil.sys','pagefile.sys','swapfile.sys',
  'desktop.ini','thumbs.db','.DS_Store'
]);

app.post('/api/filesystem', async (req, res) => {
  const { action, path: reqPath, folderName } = req.body;

  try {
    // ── List all drives ──
    if (action === 'drives') {
      const drives = [];
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const p = letter + ':\\';
        try {
          fs.readdirSync(p);
          const stat = fs.statSync(p);
          // Try to get free space via wmic
          let label = '', total = '', free = '';
          try {
            const { stdout } = await execAsync(
              `wmic logicaldisk where name="${letter}:" get VolumeName,Size,FreeSpace /format:csv`,
              { timeout: 3000 }
            );
            const lines = stdout.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
            if (lines[0]) {
              const parts = lines[0].split(',');
              free  = formatFileSize(parseInt(parts[1]) || 0);
              label = parts[2]?.trim() || '';
              total = formatFileSize(parseInt(parts[3]) || 0);
            }
          } catch(_) {}
          drives.push({ letter, path: p, label, total, free });
        } catch(_) {}
      }
      return res.json({ success: true, drives });
    }
    if (action === 'resolve') {
      const home = os.homedir();
      const map = {
        downloads: path.join(home, 'Downloads'),
        documents: path.join(home, 'Documents'),
        desktop:   path.join(home, 'Desktop'),
        pictures:  path.join(home, 'Pictures'),
        music:     path.join(home, 'Music'),
        videos:    path.join(home, 'Videos'),
        home:      home,
        appdata:   path.join(home, 'AppData')
      };
      const key = (folderName || '').toLowerCase().replace(/s$/, '');
      const resolved = map[key] || map[key + 's'] || null;
      return res.json({ success: !!resolved, path: resolved, home });
    }

    // ── Sanitize path ──
    const cleanPath = (reqPath || '').trim().replace(/\//g, '\\').replace(/\\+$/, '') || reqPath;

    // ── List directory contents ──
    if (action === 'list') {
      const target = cleanPath || reqPath;
      const raw = fs.readdirSync(target, { withFileTypes: true });
      const entries = raw
        .filter(e => !HIDDEN_NAMES.has(e.name) && !e.name.startsWith('.'))
        .map(e => {
          try {
            const full = path.join(target, e.name);
            const stat = fs.statSync(full);
            return {
              name:     e.name,
              type:     e.isDirectory() ? 'folder' : 'file',
              size:     stat.size,
              sizeFmt:  formatFileSize(stat.size),
              modified: stat.mtime.toISOString().split('T')[0],
              ext:      e.isDirectory() ? null : path.extname(e.name).toLowerCase(),
              fullPath: full
            };
          } catch {
            return { name: e.name, type: e.isDirectory() ? 'folder' : 'file', size: 0, sizeFmt: '', modified: '', ext: null, fullPath: path.join(target, e.name) };
          }
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

      console.log(`📂 Filesystem: listed ${entries.length} items in ${target}`);
      return res.json({ success: true, path: target, entries, total: entries.length });
    }

    // ── File / Folder info ──
    if (action === 'info') {
      const stat = fs.statSync(cleanPath);
      return res.json({
        success: true,
        path:    cleanPath,
        name:    path.basename(cleanPath),
        info: {
          type:     stat.isDirectory() ? 'folder' : 'file',
          size:     stat.size,
          sizeFmt:  formatFileSize(stat.size),
          created:  stat.birthtime.toISOString().split('T')[0],
          modified: stat.mtime.toISOString().split('T')[0],
          ext:      path.extname(cleanPath).toLowerCase() || null
        }
      });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });

  } catch (e) {
    const msg = e.code === 'ENOENT'  ? `Path not found: ${reqPath}` :
                e.code === 'EACCES' ? `Access denied: ${reqPath}`  :
                e.code === 'ENOTDIR' ? `Not a directory: ${reqPath}` : e.message;
    console.error(`❌ Filesystem error: ${msg}`);
    res.json({ success: false, error: msg });
  }
});

// ─── Music Access ─────────────────────────────────────────────────────────────
const AUDIO_EXTS = new Set(['.mp3','.wav','.flac','.aac','.ogg','.wma','.m4a','.opus','.ape','.aiff']);

let _musicCache = null;

function _scanMusicDir(dir, depth, results) {
  if (depth > 4) return;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        _scanMusicDir(full, depth + 1, results);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (AUDIO_EXTS.has(ext)) {
          results.push({
            name:     path.basename(e.name, ext),
            file:     e.name,
            ext,
            fullPath: full,
            nameLower: path.basename(e.name, ext).toLowerCase()
          });
        }
      }
    }
  } catch(_) {}
}

async function getMusicLibrary(forceRefresh = false) {
  if (_musicCache && !forceRefresh) return _musicCache;
  const dirs = [
    path.join(os.homedir(), 'Music'),
    'C:\\Users\\Public\\Music',
    path.join(os.homedir(), 'Downloads'),
    'D:\\Music',
    'E:\\Music',
  ];
  const tracks = [];
  for (const d of dirs) {
    if (fs.existsSync(d)) _scanMusicDir(d, 0, tracks);
  }
  _musicCache = tracks;
  console.log(`🎵 Music scan: ${tracks.length} tracks found`);
  return tracks;
}

function fuzzyFindTrack(tracks, query) {
  const q = query.toLowerCase().trim();
  let m = tracks.find(t => t.nameLower === q);
  if (m) return m;
  m = tracks.find(t => t.nameLower.startsWith(q));
  if (m) return m;
  m = tracks.find(t => t.nameLower.includes(q));
  if (m) return m;
  const words = q.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 1) {
    m = tracks.find(t => words.every(w => t.nameLower.includes(w)));
    if (m) return m;
    m = tracks.find(t => words.some(w => t.nameLower.includes(w)));
    if (m) return m;
  }
  return null;
}

app.post('/api/music', async (req, res) => {
  const { action, query, filePath } = req.body;

  // Scan music library
  if (action === 'scan') {
    const tracks = await getMusicLibrary(req.body.refresh === true);
    return res.json({ success: true, count: tracks.length, tracks: tracks.map(t => ({ name: t.name, file: t.file, path: t.fullPath })) });
  }

  // Play a specific file
  if (action === 'play') {
    if (!filePath) return res.status(400).json({ success: false, error: 'No file path' });
    if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'File not found' });
    exec(`start "" "${filePath}"`, err => { if (err) console.error('Music play error:', err.message); });
    return res.json({ success: true, playing: path.basename(filePath) });
  }

  // Search local library
  if (action === 'search') {
    if (!query) return res.status(400).json({ success: false });
    const tracks = await getMusicLibrary();
    const match = fuzzyFindTrack(tracks, query);
    return res.json({ success: !!match, match: match || null });
  }

  // Media key control (play/pause, next, previous, stop)
  if (action === 'control') {
    const KEY_MAP = { pause: 0xB3, play: 0xB3, toggle: 0xB3, next: 0xB0, previous: 0xB1, stop: 0xB2, mute: 0xAD, 'volume up': 0xAF, 'volume down': 0xAE };
    const key = KEY_MAP[req.body.key];
    if (!key) return res.json({ success: false, error: 'Unknown control key' });
    const ps = `$s=New-Object -ComObject WScript.Shell;$s.SendKeys([char]${key})`;
    exec(`cmd /c "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command "${ps}"`, err => { if (err) console.error(err.message); });
    return res.json({ success: true });
  }

  return res.status(400).json({ success: false, error: 'Unknown action' });
});

// ─── Spotify Smart Player ──────────────────────────────────────────────────────
// Tries desktop app (spotify: URI) → falls back to web, then auto-plays via keyboard
app.post('/api/spotify', async (req, res) => {
  const { action, query } = req.body;

  // ── search-play: open Spotify with query and attempt auto-play ──
  if (action === 'search-play') {
    const q = (query || '').trim();
    const webUrl = q
      ? `https://open.spotify.com/search/${encodeURIComponent(q)}`
      : 'https://open.spotify.com';
    const spotifyUri = q ? `spotify:search:${q}` : 'spotify:';

    // 1. Try desktop app via URI scheme
    exec(`start "" "${spotifyUri}"`, (desktopErr) => {
      if (desktopErr) {
        // Desktop app not installed — open web
        exec(`start "" "${webUrl}"`, () => {});
      }
    });

    // 2. After load, focus the window and press play
    setTimeout(() => {
      const ps = [
        '$ErrorActionPreference = "SilentlyContinue"',
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type @"',
        'using System; using System.Runtime.InteropServices;',
        'public class SpotifyWin {',
        '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
        '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);',
        '}',
        '"@',
        '$p = Get-Process | Where-Object { $_.MainWindowTitle -match "Spotify" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
        'if ($p) {',
        '  [SpotifyWin]::ShowWindow($p.MainWindowHandle, 9)',
        '  [SpotifyWin]::SetForegroundWindow($p.MainWindowHandle)',
        '  Start-Sleep -Milliseconds 800',
        '  # Desktop app: arrow-down to first result then Enter to play',
        '  [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")',
        '  Start-Sleep -Milliseconds 250',
        '  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
        '  Start-Sleep -Milliseconds 600',
        '  [System.Windows.Forms.SendKeys]::SendWait(" ")',
        '}',
      ].join('\n');

      const tmpFile = path.join(os.tmpdir(), `jarvis_splay_${Date.now()}.ps1`);
      fs.writeFileSync(tmpFile, ps, 'utf8');
      exec(`cmd /c "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmpFile}"`, () => {
        fs.unlink(tmpFile, () => {});
      });
    }, 3800);

    console.log(`🎵 Spotify: search-play "${q}"`);
    return res.json({ success: true, url: webUrl });
  }

  // ── control: focus Spotify window and send keyboard shortcut ──
  if (action === 'control') {
    const { key } = req.body;
    // Spotify keyboard shortcuts (work in both desktop and web)
    const spotifyKeys = {
      'play':     ' ',          // Space = play/pause
      'pause':    ' ',
      'toggle':   ' ',
      'stop':     ' ',
      'next':     '^{RIGHT}',   // Ctrl+Right = next track
      'previous': '^{LEFT}',    // Ctrl+Left  = previous track
      'mute':     '^{DOWN}',    // Ctrl+Down  = volume to 0 (mute toggle not exact but close)
      'volume up':   '^{UP}',
      'volume down': '^{DOWN}',
    };
    const sendKey = spotifyKeys[key] || ' ';
    const escapedKey = sendKey.replace(/"/g, '`"');

    const ps = [
      '$ErrorActionPreference = "SilentlyContinue"',
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type @"',
      'using System; using System.Runtime.InteropServices;',
      'public class SpotifyCtrl {',
      '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
      '}',
      '"@',
      '$p = Get-Process | Where-Object { $_.MainWindowTitle -match "Spotify" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
      'if ($p) {',
      '  [SpotifyCtrl]::SetForegroundWindow($p.MainWindowHandle)',
      '  Start-Sleep -Milliseconds 450',
      `  [System.Windows.Forms.SendKeys]::SendWait("${escapedKey}")`,
      '} else {',
      '  # Fallback: system-wide media key',
      '  $s = New-Object -ComObject WScript.Shell',
      `  $s.SendKeys([char]${key === 'next' ? '0xB0' : key === 'previous' ? '0xB1' : '0xB3'})`,
      '}',
    ].join('\n');

    const tmpFile = path.join(os.tmpdir(), `jarvis_sctrl_${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, ps, 'utf8');
    exec(`cmd /c "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmpFile}"`, () => {
      fs.unlink(tmpFile, () => {});
    });
    return res.json({ success: true });
  }

  return res.status(400).json({ success: false, error: 'Unknown action' });
});

// ─── Browser / URL Access ──────────────────────────────────────────────────────
app.post('/api/browse', async (req, res) => {
  const { url, preferChrome } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'No URL provided' });

  // Validate it looks like a URL
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });

  const result = await openInBrowser(url, !!preferChrome);
  if (!result.success) return res.status(500).json(result);
  res.json(result);
});

async function openInBrowser(url, preferChrome = false) {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) return { success: false, error: 'No URL provided' };
  if (!/^https?:\/\//i.test(targetUrl)) return { success: false, error: 'Invalid URL' };

  console.log(`🌐 Browse: ${targetUrl}`);

  if (preferChrome) {
    let chromePath = null;
    try {
      const { stdout } = await execAsync('where.exe chrome', { timeout: 2000 });
      chromePath = stdout.trim().split(/\r?\n/)[0].trim();
    } catch (_) {}

    if (!chromePath) {
      for (const p of [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]) {
        if (fs.existsSync(p)) { chromePath = p; break; }
      }
    }

    if (chromePath) {
      exec(`"${chromePath}" "${targetUrl}"`, (err) => {
        if (err) console.error('Chrome error:', err.message);
      });
      return { success: true, url: targetUrl, openedWith: 'Chrome' };
    }
  }

  exec(`start "" "${targetUrl}"`, (err) => {
    if (err) console.error('Browse error:', err.message);
  });
  await new Promise(r => setTimeout(r, 300));
  return { success: true, url: targetUrl, openedWith: 'default browser' };
}


let _scannedApps = null;

function _walkLnk(dir, depth, results) {
  if (depth > 4) return;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        _walkLnk(full, depth + 1, results);
      } else if (e.name.toLowerCase().endsWith('.lnk')) {
        const name = e.name.slice(0, -4);
        if (!name.includes('Uninstall') && !name.includes('uninstall')) {
          results.push({ name, nameLower: name.toLowerCase(), lnkPath: full });
        }
      }
    }
  } catch(_) {}
}

function _scanStartMenu() {
  const dirs = [
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
    path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(os.homedir(), 'Desktop'),
    'C:\\Users\\Public\\Desktop',
  ];
  const results = [];
  for (const d of dirs) {
    if (fs.existsSync(d)) _walkLnk(d, 0, results);
  }
  // Deduplicate by nameLower
  const seen = new Set();
  return results.filter(a => {
    if (seen.has(a.nameLower)) return false;
    seen.add(a.nameLower); return true;
  });
}

async function getScannedApps(forceRefresh = false) {
  if (!_scannedApps || forceRefresh) {
    _scannedApps = _scanStartMenu();
    console.log(`📱 App scan: ${_scannedApps.length} apps found`);
  }
  return _scannedApps;
}

function fuzzyFindApp(apps, query) {
  const q = _normalizeAppKey(query);
  if (!q) return null;
  // 1. Exact
  let m = apps.find(a => a.nameLower === q);
  if (m) return m;
  // 2. Starts with
  m = apps.find(a => a.nameLower.startsWith(q));
  if (m) return m;
  // 3. Name contains query
  m = apps.find(a => a.nameLower.includes(q));
  if (m) return m;
  // 4. All query words in name
  const words = q.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 1) {
    m = apps.find(a => words.every(w => a.nameLower.includes(w)));
    if (m) return m;
  }
  // 5. Any single word starts-with
  m = apps.find(a => words.some(w => a.nameLower.startsWith(w)));
  return m || null;
}

// Use cmd.exe /c start for reliable GUI app launching on Windows
function spawnDetached(target) {
  // exec uses cmd.exe by default — start "" is the most reliable Windows launcher
  // Works for both .exe and .lnk shortcut files
  exec(`start "" "${target}"`, (err) => {
    if (err) console.error('Launch error:', err.message);
  });
}

// GET /api/apps/scan — return full installed app list
app.get('/api/apps/scan', async (req, res) => {
  const apps = await getScannedApps(req.query.refresh === 'true');
  res.json({ success: true, count: apps.length, apps: apps.map(a => ({ name: a.name, path: a.lnkPath })) });
});

// POST /api/apps/search — fuzzy search installed apps
app.post('/api/apps/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false });
  const apps = await getScannedApps();
  const match = fuzzyFindApp(apps, query);
  res.json({ success: !!match, match: match ? { name: match.name, path: match.lnkPath } : null });
});

// ─── Rewrite /api/open-app to use scanned apps ────────────────────────────────
// Remove old open-app handler and replace with smart one that uses scan
const _openRouter = express.Router();

async function openAnyAppTarget(appName) {
  const raw = String(appName || '').trim();
  if (!raw) return { success: false, error: 'No app name provided' };
  const key = _normalizeAppKey(raw);

  // If user says "open github.com" or full URL, launch as site.
  if (_looksLikeUrlOrDomain(raw)) {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      await launchViaStart(url);
      console.log(`🌐 Opened (DOMAIN): ${url}`);
      return { success: true, opened: url, kind: 'web' };
    } catch (e) {
      console.error('Domain launch failed:', e.message);
    }
  }

  // Absolute local path: .exe/.lnk/.bat/.cmd/file/folder
  if (_looksLikeWindowsPath(raw) && fs.existsSync(raw)) {
    try {
      await launchViaStart(raw);
      console.log(`🚀 Opened (PATH): ${raw}`);
      return { success: true, opened: path.basename(raw), kind: 'path' };
    } catch (e) {
      console.error('Path launch failed:', e.message);
    }
  }

  // Hardcoded APP_MAP (built-in Windows tools)
  const entry = APP_MAP[key];
  if (entry) {
    try {
      const result = await tryLaunchApp(entry, raw);
      if (result.success) {
        console.log(`🚀 Opened (MAP): ${raw}`);
        return { success: true, opened: raw };
      }
    } catch (_) {}
  }

  // Fuzzy search scanned Start Menu shortcuts
  try {
    const apps = await getScannedApps();
    const match = fuzzyFindApp(apps, key);
    if (match) {
      spawnDetached(match.lnkPath);
      await new Promise(r => setTimeout(r, 500));
      console.log(`🚀 Opened (SCAN): ${match.name}`);
      return { success: true, opened: match.name };
    }
  } catch (e) {
    console.error('Scan search failed:', e.message);
  }

  // Last resort — try PATH
  try {
    const exeName = key.endsWith('.exe') ? key : key.replace(/\s+/g, '') + '.exe';
    const { stdout } = await execAsync(`where.exe "${exeName}"`, { timeout: 3000 });
    const found = stdout.trim().split(/\r?\n/)[0].trim();
    if (found) {
      spawnDetached(found);
      await new Promise(r => setTimeout(r, 500));
      return { success: true, opened: raw };
    }
  } catch (_) {}

  // Generic launcher fallback: lets Windows resolve aliases, shortcuts, and URI handlers.
  try {
    await launchViaStart(raw);
    console.log(`🚀 Opened (GENERIC): ${raw}`);
    return { success: true, opened: raw, kind: 'generic' };
  } catch (_) {}

  return { success: false, error: `"${raw}" wasn't found. Say "list my apps" to see what's installed.` };
}

_openRouter.post('/', async (req, res) => {
  const { appName } = req.body;
  if (!appName) return res.status(400).json({ success: false, error: 'No app name provided' });
  const result = await openAnyAppTarget(appName);
  res.json(result);
});

app.use('/api/open-app', _openRouter);

// ─── Close Application / Window ──────────────────────────────────────────────
// Maps friendly names → Windows process exe names (without .exe)
const CLOSE_PROCESS_MAP = {
  'notepad':            ['notepad'],
  'note pad':           ['notepad'],
  'notepad++':          ['notepad++'],
  'calculator':         ['calculator', 'calc'],
  'calc':               ['calculator', 'calc'],
  'paint':              ['mspaint'],
  'ms paint':           ['mspaint'],
  'wordpad':            ['wordpad'],
  'chrome':             ['chrome'],
  'google chrome':      ['chrome'],
  'firefox':            ['firefox'],
  'mozilla firefox':    ['firefox'],
  'edge':               ['msedge'],
  'microsoft edge':     ['msedge'],
  'spotify':            ['spotify'],
  'vlc':                ['vlc'],
  'vscode':             ['code'],
  'vs code':            ['code'],
  'visual studio code': ['code'],
  'teams':              ['teams', 'ms-teams'],
  'microsoft teams':    ['teams', 'ms-teams'],
  'zoom':               ['zoom'],
  'word':               ['winword'],
  'microsoft word':     ['winword'],
  'excel':              ['excel'],
  'microsoft excel':    ['excel'],
  'powerpoint':         ['powerpnt'],
  'outlook':            ['outlook'],
  'explorer':           ['explorer'],
  'file explorer':      ['explorer'],
  'cmd':                ['cmd'],
  'command prompt':     ['cmd'],
  'powershell':         ['powershell', 'pwsh'],
  'task manager':       ['taskmgr'],
  'snipping tool':      ['snippingtool', 'sniptasktool'],
  'whatsapp':           ['whatsapp', 'whatsappdesktop'],
  'telegram':           ['telegram'],
  'discord':            ['discord'],
  'slack':              ['slack'],
  'skype':              ['skype'],
  'postman':            ['postman'],
  'obs':                ['obs64', 'obs32', 'obs'],
  'obs studio':         ['obs64', 'obs32'],
  'paint 3d':           ['paintdotnet', 'mspaint'],
  'notepad plus plus':  ['notepad++'],
};

// Map browser friendly name → process exe name (for tab-title targeting)
const BROWSER_PROCESS_MAP = {
  'chrome':   'chrome',
  'google chrome': 'chrome',
  'firefox':  'firefox',
  'edge':     'msedge',
  'browser':  null,  // any browser
};

// Close by process exe name — pure CMD, no PowerShell
async function _closeByProcessName(exeNames, force) {
  let totalClosed = 0;
  for (const name of exeNames) {
    const safeExe = name.replace(/[^\w\-+#]/g, '');
    if (!safeExe) continue;
    const flag = force ? '/F ' : '';
    try {
      // Check it is actually running first
      const { stdout: tl } = await execAsync(
        `cmd /c tasklist /FI "IMAGENAME eq ${safeExe}.exe" /FO CSV /NH`,
        { timeout: 4000 }
      );
      const running = String(tl).split('\n').filter(l => l.toLowerCase().includes(`"${safeExe.toLowerCase()}.exe"`));
      if (running.length > 0) {
        await execAsync(`cmd /c taskkill ${flag}/IM "${safeExe}.exe"`, { timeout: 6000 });
        totalClosed += running.length;
        console.log(`✅ taskkill /IM ${safeExe}.exe — ${running.length} instance(s)`);
      }
    } catch (_) {}
  }
  return totalClosed;
}

// Close by window title — uses taskkill /FI "WINDOWTITLE eq ..." (no PowerShell)
// taskkill WINDOWTITLE filter does a substring/starts-with match on most Windows versions.
async function _closeByWindowTitle(titleKeyword, browserProc, force) {
  const safeTitle = String(titleKeyword || '').replace(/["%]/g, '').trim();
  if (!safeTitle) return 0;
  const flag = force ? '/F ' : '';
  let closed = 0;

  // Build candidate commands — most specific first
  const cmds = [];
  if (browserProc) {
    const safeProc = browserProc.replace(/[^\w\-]/g, '');
    // Both image name AND title filter
    cmds.push(`cmd /c taskkill ${flag}/FI "IMAGENAME eq ${safeProc}.exe" /FI "WINDOWTITLE eq ${safeTitle}"`);
  }
  // Title only (catches any process)
  cmds.push(`cmd /c taskkill ${flag}/FI "WINDOWTITLE eq ${safeTitle}"`);

  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 6000 });
      const out = String(stdout || '');
      // taskkill prints "SUCCESS: ..." or "УСПЕХ" in some locales
      const hits = (out.match(/SUCCESS|process with/gi) || []).length;
      if (hits > 0) {
        closed += hits;
        console.log(`✅ taskkill WINDOWTITLE "${safeTitle}" — ${hits} window(s)`);
        break;
      }
    } catch (_) {}
  }
  return closed;
}

app.post('/api/close-app', async (req, res) => {
  const { target, browser, force = false } = req.body;
  if (!target) return res.status(400).json({ success: false, error: 'No target provided' });

  const key = _normalizeAppKey(target);
  const forceFlag = !!force;
  console.log(`❌ Close request — target: "${target}"  browser: "${browser || 'any'}"  force: ${forceFlag}`);

  // ── 1. Known desktop app by process name ─────────────────────────────────
  if (!browser && CLOSE_PROCESS_MAP[key]) {
    const count = await _closeByProcessName(CLOSE_PROCESS_MAP[key], forceFlag);
    if (count > 0) {
      return res.json({ success: true, closed: target, count, method: 'process' });
    }
    // not running as process — fall through to title-based
  }

  // ── 2. Window-title match (browser tabs, named windows, etc.) ─────────────
  const browserProc = browser
    ? (BROWSER_PROCESS_MAP[(browser || '').toLowerCase()] || null)
    : null;

  // Build title keyword — strip UI filler words unlikely to appear in a window title
  const titleKeyword = target
    .replace(/\b(web|the|my|on|in|app|site|window|tab|page|browser)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const countTitle = await _closeByWindowTitle(titleKeyword, browserProc, forceFlag);
  if (countTitle > 0) {
    return res.json({ success: true, closed: target, count: countTitle, method: 'title' });
  }

  // ── 3. Last resort — force-kill by process name if known ─────────────────
  if (CLOSE_PROCESS_MAP[key]) {
    const count3 = await _closeByProcessName(CLOSE_PROCESS_MAP[key], true);
    if (count3 > 0) {
      return res.json({ success: true, closed: target, count: count3, method: 'force-process' });
    }
  }

  // ── 4. Try a generic taskkill by exe name derived from the target word ────
  const derivedExe = key.replace(/\s+/g, '');
  if (derivedExe) {
    try {
      await execAsync(`cmd /c taskkill /F /IM "${derivedExe}.exe"`, { timeout: 5000 });
      return res.json({ success: true, closed: target, count: 1, method: 'derived-exe' });
    } catch (_) {}
  }

  return res.json({
    success: false,
    error: `No running window found matching "${target}". It may already be closed.`
  });
});

// ─── YouTube Video Search ──────────────────────────────────────────────────────
app.post('/api/youtube-search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, error: 'No query' });
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const resp = await undicicFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    const html = await resp.text();
    // Extract unique video IDs from YouTube's embedded JSON data
    const rawMatches = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/g) || [];
    const videoIds = [...new Set(rawMatches.map(m => m.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)[1]))].slice(0, 8);
    // Try to extract video titles
    const titleRaw = html.match(/"title":\{"runs":\[\{"text":"([^"]{1,150})"/g) || [];
    const titles = titleRaw.slice(0, 8).map(m => { const tm = m.match(/"text":"([^"]+)"/); return tm ? tm[1] : ''; });
    if (videoIds.length > 0) {
      console.log(`🎵 YouTube search "${query}" → ${videoIds.length} results`);
      return res.json({ success: true, videoIds, titles });
    }
    console.warn(`⚠️  YouTube search "${query}" returned no results`);
    return res.json({ success: false, videoIds: [], error: 'No results found' });
  } catch (e) {
    console.error('YouTube search error:', e.message);
    return res.json({ success: false, error: e.message, videoIds: [] });
  }
});

// ═══════════════════════════════════════════════════════════════
// DOCUMENT INTELLIGENCE — Upload, parse, store, answer from docs
// ═══════════════════════════════════════════════════════════════

const SUPPORTED_EXTS = new Set(['pdf','docx','txt','md','csv','json','xml','html','js','java','py','ts','cs','cpp','c','rb','go','rs','kt','swift']);

app.post('/api/upload-document', _upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file received' });

  const { originalname, buffer } = req.file;
  const ext = originalname.split('.').pop().toLowerCase().replace(/[^a-z]/g, '');

  if (!SUPPORTED_EXTS.has(ext)) {
    return res.status(400).json({ success: false, error: `Unsupported file type: .${ext}. Supported: PDF, DOCX, TXT, MD, CSV, JSON, and source code files.` });
  }

  try {
    let text = '';

    if (ext === 'pdf') {
      if (typeof PDFParse !== 'function') {
        throw new Error('PDF parser module did not expose PDFParse');
      }

      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        text = parsed?.text || '';
      } finally {
        await parser.destroy().catch(() => {});
      }
    } else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
    } else {
      text = buffer.toString('utf8');
    }

    // Clean up excessive whitespace
    text = text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim();

    let truncated = false;
    if (text.length > MAX_DOC_CHARS) {
      text = text.slice(0, MAX_DOC_CHARS);
      // Trim to last complete sentence/line
      const lastNL = text.lastIndexOf('\n');
      if (lastNL > MAX_DOC_CHARS * 0.9) text = text.slice(0, lastNL);
      truncated = true;
    }

    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    documentStore.set(docId, {
      id:          docId,
      name:        originalname,
      ext,
      text,
      chunks:      _buildDocChunks(text),
      charCount:   text.length,
      truncated,
      uploadedAt:  new Date().toISOString()
    });

    console.log(`📄 Document uploaded: "${originalname}" — ${text.length} chars${truncated ? ' (truncated)' : ''}`);

    res.json({
      success:   true,
      docId,
      name:      originalname,
      charCount: text.length,
      truncated,
      preview:   text.slice(0, 400).replace(/\s+/g, ' ').trim() + (text.length > 400 ? '…' : '')
    });

  } catch (err) {
    console.error('❌ Document parse error:', err.message);
    res.status(500).json({ success: false, error: `Could not read document: ${err.message}` });
  }
});

app.delete('/api/documents/:id', (req, res) => {
  if (documentStore.delete(req.params.id)) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Document not found' });
  }
});

app.get('/api/documents', (_req, res) => {
  const list = [...documentStore.values()].map(({ id, name, ext, charCount, truncated, uploadedAt }) =>
    ({ id, name, ext, charCount, truncated, uploadedAt })
  );
  res.json({ success: true, documents: list });
});

// ─── WhatsApp Cloud API Integration ──────────────────────────────────────────
const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_ENABLED = !!(WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN && WHATSAPP_VERIFY_TOKEN);
const WHATSAPP_REQUIRE_CONFIRM = String(process.env.WHATSAPP_REQUIRE_CONFIRM || 'true').toLowerCase() !== 'false';
const WHATSAPP_CONFIRM_WINDOW_MS = Number(process.env.WHATSAPP_CONFIRM_WINDOW_MS || 120000);
const WHATSAPP_ALLOWED_NUMBERS = new Set(
  String(process.env.WHATSAPP_ALLOWED_NUMBERS || '')
    .split(',')
    .map(v => v.trim().replace(/[^\d]/g, ''))
    .filter(Boolean)
);

const WA_SITE_MAP = {
  google: 'https://www.google.com',
  youtube: 'https://www.youtube.com',
  gmail: 'https://mail.google.com',
  whatsapp: 'https://web.whatsapp.com',
  github: 'https://github.com',
  linkedin: 'https://www.linkedin.com',
  instagram: 'https://www.instagram.com',
  facebook: 'https://www.facebook.com',
  reddit: 'https://www.reddit.com',
  netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com',
  chatgpt: 'https://chatgpt.com',
  copilot: 'https://copilot.microsoft.com'
};

const _waPendingActions = new Map();
let _waPendingSeq = 1;

function _normalizeWaNumber(input) {
  return String(input || '').replace(/[^\d]/g, '');
}

function _isWaSenderAllowed(sender) {
  const normalized = _normalizeWaNumber(sender);
  if (!normalized) return false;
  if (!WHATSAPP_ALLOWED_NUMBERS.size) return true;
  return WHATSAPP_ALLOWED_NUMBERS.has(normalized);
}

function _trimWaReply(text, maxLen = 1400) {
  const clean = String(text || '').replace(/\u0000/g, '').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 12) + '\n...[truncated]';
}

async function sendWhatsAppText(to, body) {
  if (!WHATSAPP_ENABLED) {
    return { success: false, error: 'WhatsApp integration is disabled in .env' };
  }

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: _normalizeWaNumber(to),
    type: 'text',
    text: { body: _trimWaReply(body) }
  };

  try {
    const resp = await undicicFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const reason = data?.error?.message || `HTTP ${resp.status}`;
      console.error('WhatsApp send failed:', reason);
      return { success: false, error: reason };
    }
    return { success: true, data };
  } catch (e) {
    console.error('WhatsApp send exception:', e.message);
    return { success: false, error: e.message };
  }
}

function resolveWebTarget(raw) {
  const text = String(raw || '').trim();
  const low = text.toLowerCase();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(text)) return `https://${text}`;
  if (WA_SITE_MAP[low]) return WA_SITE_MAP[low];
  return null;
}

function parseWhatsAppCommand(input) {
  const text = String(input || '').trim();
  const low = text.toLowerCase();

  if (!text) return { type: 'empty' };
  if (/^help$/i.test(low)) return { type: 'help' };
  if (/^system\s+info$/i.test(low)) return { type: 'system_info' };
  if (/^list\s+apps?$/i.test(low)) return { type: 'list_apps' };

  const confirmMatch = low.match(/^confirm\s+(\d+)$/i);
  if (confirmMatch) return { type: 'confirm', id: confirmMatch[1] };

  const cancelMatch = low.match(/^cancel\s+(\d+)$/i);
  if (cancelMatch) return { type: 'cancel', id: cancelMatch[1] };

  const runMatch = text.match(/^run\s+(.+)$/i);
  if (runMatch) return { type: 'run_command', command: runMatch[1].trim() };

  const openAppMatch = text.match(/^open\s+app\s+(.+)$/i);
  if (openAppMatch) return { type: 'app_open', target: openAppMatch[1].trim() };

  const openSiteMatch = text.match(/^open\s+site\s+(.+)$/i);
  if (openSiteMatch) return { type: 'web_open', url: resolveWebTarget(openSiteMatch[1]) };

  const openMatch = text.match(/^open\s+(.+)$/i);
  if (openMatch) {
    const target = openMatch[1].trim();
    const webUrl = resolveWebTarget(target);
    if (webUrl) return { type: 'web_open', url: webUrl };
    return { type: 'app_open', target };
  }

  return { type: 'unknown' };
}

function _requiresWhatsAppConfirmation(parsed) {
  if (!WHATSAPP_REQUIRE_CONFIRM) return false;
  return parsed.type === 'run_command' || parsed.type === 'app_open';
}

function _queuePendingWhatsAppAction(from, parsed) {
  const id = String(_waPendingSeq++);
  _waPendingActions.set(id, {
    id,
    from: _normalizeWaNumber(from),
    parsed,
    createdAt: Date.now()
  });
  return id;
}

function _cleanupPendingWhatsAppActions() {
  const now = Date.now();
  for (const [id, item] of _waPendingActions.entries()) {
    if (now - item.createdAt > WHATSAPP_CONFIRM_WINDOW_MS) {
      _waPendingActions.delete(id);
    }
  }
}

async function _executeWhatsAppParsedCommand(parsed) {
  if (parsed.type === 'help') {
    return {
      success: true,
      reply:
`JARVIS WhatsApp Commands:\n\n` +
`- help\n` +
`- system info\n` +
`- list apps\n` +
`- open app <name>\n` +
`- open <app|site|domain>\n` +
`- open site <url/domain/name>\n` +
`- run <powershell command>\n` +
`- confirm <id>\n` +
`- cancel <id>`
    };
  }

  if (parsed.type === 'system_info') {
    const total = os.totalmem();
    const free = os.freemem();
    const usedPct = Math.round(((total - free) / total) * 100);
    const msg =
`System:\n` +
`Host: ${os.hostname()}\n` +
`OS: ${os.type()} ${os.release()} (${os.arch()})\n` +
`CPU Cores: ${os.cpus().length}\n` +
`RAM Used: ${formatFileSize(total - free)} / ${formatFileSize(total)} (${usedPct}%)\n` +
`Uptime: ${_fmtUptime(os.uptime())}`;
    return { success: true, reply: msg };
  }

  if (parsed.type === 'list_apps') {
    const apps = await getScannedApps();
    if (!apps.length) return { success: true, reply: 'No Start Menu apps were found.' };
    const sample = apps.slice(0, 40).map(a => `- ${a.name}`).join('\n');
    const more = apps.length > 40 ? `\n...and ${apps.length - 40} more.` : '';
    return { success: true, reply: `Installed apps (${apps.length}):\n${sample}${more}` };
  }

  if (parsed.type === 'web_open') {
    if (!parsed.url) return { success: false, reply: 'Please provide a valid URL/domain/site name.' };
    const result = await openInBrowser(parsed.url, false);
    return result.success
      ? { success: true, reply: `Opened: ${result.url}` }
      : { success: false, reply: `Failed to open site: ${result.error}` };
  }

  if (parsed.type === 'app_open') {
    const result = await openAnyAppTarget(parsed.target);
    return result.success
      ? { success: true, reply: `Opened app: ${result.opened}` }
      : { success: false, reply: result.error || `Unable to open: ${parsed.target}` };
  }

  if (parsed.type === 'run_command') {
    const result = await executeShellCommand(parsed.command, 'powershell');
    if (!result.success) {
      return { success: false, reply: `Command failed: ${result.error || 'Unknown error'}` };
    }
    const output = result.stdout || '(no output)';
    return { success: true, reply: `Done.\n\nCommand: ${result.command}\n\n${output}` };
  }

  if (parsed.type === 'empty') {
    return { success: true, reply: 'Send a command like: help' };
  }

  return { success: false, reply: 'Unknown command. Send "help" to see supported commands.' };
}

async function handleIncomingWhatsAppText(from, text) {
  _cleanupPendingWhatsAppActions();

  if (!_isWaSenderAllowed(from)) {
    await sendWhatsAppText(from, 'Access denied for this number. Ask owner to add you to WHATSAPP_ALLOWED_NUMBERS.');
    return;
  }

  const parsed = parseWhatsAppCommand(text);

  if (parsed.type === 'confirm') {
    const pending = _waPendingActions.get(parsed.id);
    if (!pending) {
      await sendWhatsAppText(from, `No pending action found for id ${parsed.id}.`);
      return;
    }
    if (pending.from !== _normalizeWaNumber(from)) {
      await sendWhatsAppText(from, 'That action was created by another number and cannot be confirmed here.');
      return;
    }
    if (Date.now() - pending.createdAt > WHATSAPP_CONFIRM_WINDOW_MS) {
      _waPendingActions.delete(parsed.id);
      await sendWhatsAppText(from, `Action ${parsed.id} expired. Send command again.`);
      return;
    }

    _waPendingActions.delete(parsed.id);
    const result = await _executeWhatsAppParsedCommand(pending.parsed);
    await sendWhatsAppText(from, result.reply);
    return;
  }

  if (parsed.type === 'cancel') {
    const pending = _waPendingActions.get(parsed.id);
    if (!pending) {
      await sendWhatsAppText(from, `No pending action found for id ${parsed.id}.`);
      return;
    }
    if (pending.from !== _normalizeWaNumber(from)) {
      await sendWhatsAppText(from, 'That action was created by another number and cannot be cancelled here.');
      return;
    }
    _waPendingActions.delete(parsed.id);
    await sendWhatsAppText(from, `Cancelled action ${parsed.id}.`);
    return;
  }

  if (_requiresWhatsAppConfirmation(parsed)) {
    const id = _queuePendingWhatsAppAction(from, parsed);
    const summary = parsed.type === 'run_command'
      ? `run command: ${parsed.command}`
      : `open app: ${parsed.target}`;
    await sendWhatsAppText(
      from,
      `Approval required for action #${id}: ${summary}\n\nReply: confirm ${id}\nOr: cancel ${id}\n\nExpires in ${Math.round(WHATSAPP_CONFIRM_WINDOW_MS / 1000)} seconds.`
    );
    return;
  }

  const result = await _executeWhatsAppParsedCommand(parsed);
  await sendWhatsAppText(from, result.reply);
}

// Meta verification endpoint
app.get('/api/whatsapp/webhook', (req, res) => {
  if (!WHATSAPP_ENABLED) {
    return res.status(503).send('WhatsApp integration is disabled');
  }

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Verification failed');
});

// Incoming WhatsApp messages
app.post('/api/whatsapp/webhook', async (req, res) => {
  if (!WHATSAPP_ENABLED) {
    return res.status(200).json({ success: true, ignored: true, reason: 'disabled' });
  }

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const value = change.value || {};
        const messages = value.messages || [];
        for (const message of messages) {
          if (message.type !== 'text') continue;
          const from = message.from;
          const text = message.text?.body || '';
          if (!from || !text) continue;

          console.log(`📲 WhatsApp command from ${from}: ${text}`);
          await handleIncomingWhatsAppText(from, text);
        }
      }
    }
  } catch (e) {
    console.error('WhatsApp webhook processing failed:', e.message);
  }

  // Always ACK quickly so WhatsApp does not retry aggressively
  res.status(200).json({ success: true });
});

app.get('/api/whatsapp/status', (_req, res) => {
  res.json({
    success: true,
    enabled: WHATSAPP_ENABLED,
    requireConfirm: WHATSAPP_REQUIRE_CONFIRM,
    confirmWindowSec: Math.round(WHATSAPP_CONFIRM_WINDOW_MS / 1000),
    allowListCount: WHATSAPP_ALLOWED_NUMBERS.size,
    pendingActions: _waPendingActions.size
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── EXTENDED FEATURES — Reminders, Notes, Process Monitor, Network, Git,
//    Code Sandbox, News, Breach Check, Audit Log, Transcription, Vision AI,
//    Image Generation, Window Manager, Telegram Bot
// ═══════════════════════════════════════════════════════════════════════════════

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function _readData(filename, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8')); }
  catch { return fallback !== undefined ? fallback : []; }
}
function _writeData(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

// ─── Reminders ───────────────────────────────────────────────────────────────
app.get('/api/reminders', (_req, res) => res.json({ success: true, reminders: _readData('reminders.json') }));

app.post('/api/reminders', (req, res) => {
  const { text, dueAt } = req.body || {};
  if (!text) return res.status(400).json({ success: false, error: 'text required' });
  const list = _readData('reminders.json');
  const item = { id: Date.now().toString(), text: String(text).slice(0, 500), dueAt: dueAt || null, createdAt: new Date().toISOString(), fired: false };
  list.push(item);
  _writeData('reminders.json', list);
  res.json({ success: true, reminder: item });
});

app.delete('/api/reminders/:id', (req, res) => {
  _writeData('reminders.json', _readData('reminders.json').filter(r => r.id !== req.params.id));
  res.json({ success: true });
});

app.patch('/api/reminders/:id/fired', (req, res) => {
  const list = _readData('reminders.json');
  const r = list.find(x => x.id === req.params.id);
  if (r) { r.fired = true; _writeData('reminders.json', list); }
  res.json({ success: true });
});

// ─── Notes ───────────────────────────────────────────────────────────────────
app.get('/api/notes', (_req, res) => res.json({ success: true, notes: _readData('notes.json') }));

app.post('/api/notes', (req, res) => {
  const { title, content, tags } = req.body || {};
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  const list = _readData('notes.json');
  const note = {
    id: Date.now().toString(),
    title: String(title).slice(0, 200),
    content: String(content || '').slice(0, 50000),
    tags: Array.isArray(tags) ? tags.map(t => String(t).slice(0, 50)) : [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  list.unshift(note);
  _writeData('notes.json', list);
  res.json({ success: true, note });
});

app.put('/api/notes/:id', (req, res) => {
  const list = _readData('notes.json');
  const idx = list.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'not found' });
  const { title, content, tags } = req.body || {};
  if (title   !== undefined) list[idx].title   = String(title).slice(0, 200);
  if (content !== undefined) list[idx].content = String(content).slice(0, 50000);
  if (tags    !== undefined) list[idx].tags    = Array.isArray(tags) ? tags : [];
  list[idx].updatedAt = new Date().toISOString();
  _writeData('notes.json', list);
  res.json({ success: true, note: list[idx] });
});

app.delete('/api/notes/:id', (req, res) => {
  _writeData('notes.json', _readData('notes.json').filter(n => n.id !== req.params.id));
  res.json({ success: true });
});

// ─── Process Monitor ─────────────────────────────────────────────────────────
app.get('/api/process-monitor', async (_req, res) => {
  try {
    const { stdout } = await execAsync('tasklist /FO CSV /NH', { timeout: 8000 });
    const processes = stdout.trim().split('\n').filter(Boolean).map(line => {
      const p = line.split('","').map(s => s.replace(/"/g, '').trim());
      return { name: p[0], pid: p[1], session: p[2], memKB: parseInt((p[4] || '0').replace(/[^\d]/g, ''), 10) };
    }).filter(p => p.name);
    processes.sort((a, b) => b.memKB - a.memKB);
    res.json({ success: true, processes: processes.slice(0, 60) });
  } catch (e) { res.json({ success: false, error: e.message, processes: [] }); }
});

app.post('/api/process-monitor/kill', async (req, res) => {
  const { pid } = req.body || {};
  if (!pid || !/^\d+$/.test(String(pid))) return res.status(400).json({ success: false, error: 'Invalid PID' });
  try { await execAsync(`taskkill /PID ${pid} /F`, { timeout: 5000 }); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

// ─── Network Info ─────────────────────────────────────────────────────────────
app.get('/api/network-info', async (_req, res) => {
  try {
    const pingOut = await execAsync('ping -n 2 8.8.8.8', { timeout: 10000 }).then(r => r.stdout).catch(() => '');
    const ifaces = Object.entries(os.networkInterfaces())
      .map(([name, addrs]) => ({ name, addresses: (addrs || []).filter(a => !a.internal).map(a => ({ address: a.address, family: a.family })) }))
      .filter(i => i.addresses.length);
    const pingMatch = pingOut.match(/Average\s*=\s*(\d+)ms/i) || pingOut.match(/time[<=](\d+)ms/i);
    res.json({ success: true, interfaces: ifaces, online: /Reply from/i.test(pingOut), pingMs: pingMatch ? parseInt(pingMatch[1], 10) : null });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ─── Git Integration ──────────────────────────────────────────────────────────
const _GIT_SAFE_CMDS = new Set(['status','log','diff','branch','add','commit','push','pull','fetch','stash','checkout','reset','show','remote']);

app.post('/api/git', async (req, res) => {
  const { cwd, subcommand, args } = req.body || {};
  if (!subcommand || !_GIT_SAFE_CMDS.has(subcommand.toLowerCase()))
    return res.status(400).json({ success: false, error: 'Disallowed git subcommand' });
  const safeCwd  = cwd && fs.existsSync(String(cwd)) ? String(cwd) : process.cwd();
  const safeArgs = (Array.isArray(args) ? args : [String(args || '')]).map(a => String(a).replace(/[;&|`$<>]/g, '')).join(' ').trim();
  try {
    const { stdout, stderr } = await execAsync(`git ${subcommand} ${safeArgs}`.trim(), { cwd: safeCwd, timeout: 15000 });
    res.json({ success: true, output: (stdout + stderr).trim() || '(no output)' });
  } catch (e) { res.json({ success: false, error: e.message, output: ((e.stdout||'') + (e.stderr||'')).trim() }); }
});

// ─── Code Sandbox ─────────────────────────────────────────────────────────────
const _SANDBOX_DANGER = /require\s*\(\s*['"](?:child_process|fs|net|http|https|os|cluster|worker_threads|vm)['"]|process\.exit|__dirname|__filename|eval\s*\(|Function\s*\(/i;

app.post('/api/run-code', async (req, res) => {
  const { code, language } = req.body || {};
  if (!code || typeof code !== 'string') return res.status(400).json({ success: false, error: 'code required' });
  const lang = (language || 'javascript').toLowerCase();
  if ((lang === 'javascript' || lang === 'js') && _SANDBOX_DANGER.test(code))
    return res.json({ success: false, error: 'Blocked: dangerous module/function detected' });
  const tmpDir = os.tmpdir();
  let file;
  try {
    let cmd;
    if (lang === 'javascript' || lang === 'js' || lang === 'node') {
      file = path.join(tmpDir, `jv_sb_${Date.now()}.js`); cmd = `node "${file}"`;
    } else if (lang === 'python' || lang === 'py') {
      file = path.join(tmpDir, `jv_sb_${Date.now()}.py`); cmd = `python "${file}"`;
    } else { return res.json({ success: false, error: 'Supported: javascript, python' }); }
    fs.writeFileSync(file, code, 'utf8');
    const { stdout, stderr } = await execAsync(cmd, { timeout: 10000, cwd: tmpDir });
    res.json({ success: true, output: (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim() || '(no output)' });
  } catch (e) { res.json({ success: false, error: e.message, output: e.stdout || '' }); }
  finally { if (file) try { fs.unlinkSync(file); } catch {} }
});

// ─── News Feed (BBC RSS + extra feeds) ───────────────────────────────────────
const _RSS_FEEDS = {
  tech:        'https://feeds.bbci.co.uk/news/technology/rss.xml',
  world:       'https://feeds.bbci.co.uk/news/world/rss.xml',
  science:     'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  business:    'https://feeds.bbci.co.uk/news/business/rss.xml',
  hn:          'https://hnrss.org/frontpage',
  india:       'https://feeds.feedburner.com/ndtvnews-top-stories',
  sports:      'https://feeds.bbci.co.uk/sport/rss.xml',
  health:      'https://feeds.bbci.co.uk/news/health/rss.xml',
  entertainment:'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'
};

// Shared RSS parse helper
async function _parseRssFeed(url, limit) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'JARVIS/2.0' }, signal: AbortSignal.timeout(10000) });
  const xml  = await resp.text();
  return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].slice(0, limit || 15).map(m => {
    const b = m[1];
    const title   = (b.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]||'').trim();
    const link    = (b.match(/<link>(.*?)<\/link>/s)?.[1]||b.match(/<guid[^>]*>(https?[^<]+)<\/guid>/)?.[1]||'').trim();
    const desc    = (b.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s)?.[1]||'').replace(/<[^>]+>/g,'').trim().slice(0,200);
    const pubDate = (b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]||'').trim();
    return { title, link, desc, pubDate };
  }).filter(i => i.title);
}

app.get('/api/news', async (req, res) => {
  const cat = _RSS_FEEDS[req.query.category] ? req.query.category : 'tech';
  try {
    const items = await _parseRssFeed(_RSS_FEEDS[cat], 15);
    res.json({ success: true, items, category: cat });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ─── News Context for AI — fetches headlines from multiple feeds so JARVIS
//     can answer "what's in the news today?" with real data injected into prompt
const _newsCache    = new Map();  // category → { items, fetchedAt }
const _NEWS_TTL_MS  = 15 * 60 * 1000; // 15 minutes

async function getNewsSummaryContext(categories) {
  const cats = (categories && categories.length) ? categories : ['tech', 'world', 'business'];
  let context = '=== LIVE NEWS HEADLINES (fetched right now) ===\n';
  for (const cat of cats) {
    const cached = _newsCache.get(cat);
    let items;
    if (cached && Date.now() - cached.fetchedAt < _NEWS_TTL_MS) {
      items = cached.items;
    } else {
      try {
        items = await _parseRssFeed(_RSS_FEEDS[cat] || _RSS_FEEDS.tech, 8);
        _newsCache.set(cat, { items, fetchedAt: Date.now() });
      } catch { items = []; }
    }
    if (items.length) {
      context += `\n[${cat.toUpperCase()} NEWS]\n`;
      items.forEach((item, i) => {
        context += `${i + 1}. ${item.title}`;
        if (item.desc) context += ` — ${item.desc.slice(0, 120)}`;
        if (item.pubDate) context += ` (${item.pubDate})`;
        context += '\n';
      });
    }
  }
  context += '\n=== END NEWS ===\n';
  return context;
}

app.get('/api/news-context', async (req, res) => {
  const cats = req.query.categories ? String(req.query.categories).split(',').map(s => s.trim()).filter(s => _RSS_FEEDS[s]) : ['tech', 'world', 'business'];
  try {
    const context = await getNewsSummaryContext(cats);
    res.json({ success: true, context });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ─── Breach Check (HaveIBeenPwned k-Anonymity) ───────────────────────────────
const _crypto = require('crypto');

app.post('/api/breach-check', async (req, res) => {
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') return res.status(400).json({ success: false, error: 'password required' });
  const hash   = _crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const resp  = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'User-Agent': 'JARVIS-BreachCheck/1.0', 'Add-Padding': 'true' }, signal: AbortSignal.timeout(8000) });
    const text  = await resp.text();
    const match = text.split('\n').find(l => l.toUpperCase().startsWith(suffix + ':'));
    const count = match ? parseInt(match.split(':')[1], 10) : 0;
    res.json({ success: true, pwned: count > 0, count });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ─── Audit Log ────────────────────────────────────────────────────────────────
app.get('/api/audit-log', (_req, res) => res.json({ success: true, log: _readData('audit-log.json').slice(-200) }));

app.post('/api/audit-log', (req, res) => {
  const { action, detail } = req.body || {};
  if (!action) return res.status(400).json({ success: false, error: 'action required' });
  const log = _readData('audit-log.json');
  log.push({ action: String(action).slice(0,200), detail: String(detail||'').slice(0,500), timestamp: new Date().toISOString() });
  if (log.length > 1000) log.splice(0, log.length - 1000);
  _writeData('audit-log.json', log);
  res.json({ success: true });
});

// ─── Audio Transcription (Groq Whisper) ──────────────────────────────────────
app.post('/api/transcribe', _upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No audio file received' });
  if (!_groqKeys.length) return res.json({ success: false, error: 'No Groq API key configured' });
  const groqKey  = _groqKeys[_groqKeyIdx % _groqKeys.length];
  const boundary = `JarvisAudioBoundary${Date.now()}`;
  const filename = (req.file.originalname || 'audio.webm').replace(/[^\w.-]/g, '_');
  const mime     = req.file.mimetype || 'audio/webm';
  try {
    const formBuffer = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      req.file.buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: formBuffer
    });
    const text = await resp.text();
    if (!resp.ok) return res.json({ success: false, error: text.slice(0, 300) });
    res.json({ success: true, transcript: text.trim() });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ─── Vision AI (Gemini Vision — native REST API) ──────────────────────────────
app.post('/api/vision', _upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No image received' });
  if (!_geminiKeys.length) return res.json({ success: false, error: 'No Gemini API key configured. Add GEMINI_API_KEY to .env' });
  const geminiKey = _geminiKeys[_geminiKeyIdx % _geminiKeys.length];
  _geminiKeyIdx = (_geminiKeyIdx + 1) % _geminiKeys.length; // rotate for next call
  const question  = String(req.body.question || 'Describe what you see in this image in detail.').slice(0, 1000);
  try {
    const payload = { contents: [{ parts: [{ text: question }, { inlineData: { mimeType: req.file.mimetype || 'image/jpeg', data: req.file.buffer.toString('base64') } }] }] };
    const resp    = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    const data    = await resp.json();
    const answer  = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from vision model.';
    res.json({ success: true, answer });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ─── Image Generation (Pollinations.ai — free, no key) ───────────────────────
app.post('/api/image-gen', (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });
  const safe = encodeURIComponent(String(prompt).slice(0, 500));
  res.json({ success: true, imageUrl: `https://image.pollinations.ai/prompt/${safe}?width=512&height=512&nologo=true` });
});

// ─── Window Manager ───────────────────────────────────────────────────────────
app.get('/api/windows', async (_req, res) => {
  try {
    const psCmd = `[System.Diagnostics.Process]::GetProcesses() | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -Property Id,ProcessName,MainWindowTitle | ConvertTo-Json`;
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { timeout: 8000 });
    let windows = [];
    try { windows = JSON.parse(stdout); if (!Array.isArray(windows)) windows = [windows]; } catch {}
    res.json({ success: true, windows: windows.filter(Boolean).slice(0, 30) });
  } catch (e) { res.json({ success: false, error: e.message, windows: [] }); }
});

app.post('/api/windows/action', async (req, res) => {
  const { pid, action } = req.body || {};
  if (!pid || !/^\d+$/.test(String(pid))) return res.status(400).json({ success: false, error: 'Invalid PID' });
  if (action === 'close') {
    try { await execAsync(`taskkill /PID ${pid} /F`, { timeout: 5000 }); res.json({ success: true }); }
    catch (e) { res.json({ success: false, error: e.message }); }
  } else if (action === 'focus') {
    const psCmd = `$p=[System.Diagnostics.Process]::GetProcessById(${pid});Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.Interaction]::AppActivate($p.Id)`;
    try { await execAsync(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 5000 }); res.json({ success: true }); }
    catch (e) { res.json({ success: false, error: e.message }); }
  } else { res.status(400).json({ success: false, error: 'action must be close or focus' }); }
});

// ─── Telegram Bot ──────────────────────────────────────────────────────────────
let _telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
const _telegramAllowed = new Set(
  String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

async function _sendTelegramMsg(chatId, text) {
  if (!_telegramToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${_telegramToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096), parse_mode: 'Markdown' })
    });
  } catch {}
}

app.get('/api/telegram/status', (_req, res) => {
  res.json({ configured: !!_telegramToken, allowedCount: _telegramAllowed.size });
});

app.post('/api/telegram/webhook', async (req, res) => {
  const { message } = req.body || {};
  res.sendStatus(200);
  if (!message) return;
  const chatId = String(message.chat?.id || '');
  const text   = String(message.text || '').trim();
  if (!chatId || !text) return;
  if (_telegramAllowed.size && !_telegramAllowed.has(chatId)) { await _sendTelegramMsg(chatId, '🚫 Access denied.'); return; }
  const parsed = parseWhatsAppCommand(text);
  const result = await _executeWhatsAppParsedCommand(parsed);
  await _sendTelegramMsg(chatId, result.reply || (result.success ? '✅ Done' : '❌ Failed'));
});

app.post('/api/telegram/send', async (req, res) => {
  const { chatId, text } = req.body || {};
  if (!chatId || !text) return res.status(400).json({ success: false, error: 'chatId and text required' });
  await _sendTelegramMsg(String(chatId), text);
  res.json({ success: true });
});

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('  ║    JARVIS — ENHANCED SERVER STARTED 🚀                  ║');
  console.log(`  ║   Open : http://localhost:${PORT}                              ║`);
  console.log(`  ║   Model: ${GROQ_MODEL}           ║`);
  console.log('  ║                                                          ║');
  console.log('  ║   Features Enabled:                                      ║');
  console.log('  ║   ✓ User Profiling & Learning                           ║');
  console.log('  ║   ✓ Sentiment Analysis                                   ║');
  console.log('  ║   ✓ Intent Detection                                     ║');
  console.log('  ║   ✓ Entity Recognition                                   ║');
  console.log('  ║   ✓ Real-time Feedback                                   ║');
  console.log('  ║   ✓ Personalized Responses                               ║');
  console.log(`  ║   ✓ WhatsApp Bridge: ${WHATSAPP_ENABLED ? 'ENABLED' : 'DISABLED'}                           ║`);
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
});