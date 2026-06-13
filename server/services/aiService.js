'use strict';

const logger = require('../utils/logger');

// ─── API Key Arrays ───────────────────────────────────────────────────────────

const _groqKeys = [
  process.env.GROQ_API_KEY,   process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7, process.env.GROQ_API_KEY_8,
].filter(Boolean);

const _geminiKeys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
].filter(Boolean);

const _openrouterKeys = [
  process.env.OPENROUTER_API_KEY,
  process.env.OPENROUTER_API_KEY_2,
  process.env.OPENROUTER_API_KEY_3,
].filter(Boolean);

// ─── Provider Constants ───────────────────────────────────────────────────────

const GROQ_API_URL       = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL         = 'llama-3.3-70b-versatile';
const GEMINI_API_URL     = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL       = 'gemini-2.0-flash';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL   = 'meta-llama/llama-3.3-70b-instruct:free';

// ─── Key Rotation Indices ─────────────────────────────────────────────────────

let _groqKeyIdx = 0, _geminiKeyIdx = 0, _openrouterKeyIdx = 0;

// ─── Validate Keys on Startup ─────────────────────────────────────────────────

function validateKeys() {
  if (!_groqKeys.length && !_geminiKeys.length && !_openrouterKeys.length) {
    logger.error('No API keys found! Set at least GROQ_API_KEY in .env');
    process.exit(1);
  }
  logger.info(`Keys loaded: ${_groqKeys.length} Groq | ${_geminiKeys.length} Gemini | ${_openrouterKeys.length} OpenRouter`);
}

// ─── Internal: Try one provider, rotating keys on 429/503 ────────────────────

async function _callProvider(keys, keyIdxRef, url, modelOverride, body, providerName) {
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx     = keyIdxRef.val % keys.length;
    const key     = keys[idx];
    const payload = modelOverride ? { ...body, model: modelOverride } : body;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
    if (providerName === 'OpenRouter') {
      headers['HTTP-Referer'] = 'http://localhost:3000';
      headers['X-Title']      = 'JARVIS';
    }
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (resp.status === 429 || resp.status === 503) {
      logger.warn(`${providerName} key #${idx + 1} rate-limited — rotating...`);
      keyIdxRef.val = (idx + 1) % keys.length;
      continue;
    }
    return resp;
  }
  return null;
}

// ─── Master AI Call: Groq → Gemini → OpenRouter ──────────────────────────────

async function callGroq(body) {
  // 1. Try all Groq keys
  if (_groqKeys.length > 0) {
    const ref  = { val: _groqKeyIdx };
    const resp = await _callProvider(_groqKeys, ref, GROQ_API_URL, null, body, 'Groq');
    _groqKeyIdx = ref.val;
    if (resp) return resp;
    logger.warn('All Groq keys exhausted — falling back to Gemini...');
  }

  // 2. Try all Gemini keys
  if (_geminiKeys.length > 0) {
    const ref  = { val: _geminiKeyIdx };
    const resp = await _callProvider(_geminiKeys, ref, GEMINI_API_URL, GEMINI_MODEL, body, 'Gemini');
    _geminiKeyIdx = ref.val;
    if (resp) { logger.info('Served by Gemini fallback'); return resp; }
    logger.warn('All Gemini keys exhausted — falling back to OpenRouter...');
  }

  // 3. Try all OpenRouter keys
  if (_openrouterKeys.length > 0) {
    const ref  = { val: _openrouterKeyIdx };
    const resp = await _callProvider(_openrouterKeys, ref, OPENROUTER_API_URL, OPENROUTER_MODEL, body, 'OpenRouter');
    _openrouterKeyIdx = ref.val;
    if (resp) { logger.info('Served by OpenRouter fallback'); return resp; }
  }

  // All providers exhausted
  logger.error('All AI providers rate-limited!');
  const msg = 'All AI providers are rate-limited. Add more keys: groq.com/keys · aistudio.google.com · openrouter.ai';
  return {
    ok:     false,
    status: 429,
    text:   async () => JSON.stringify({ error: { message: msg, code: 'all_providers_exhausted' } }),
    json:   async () => ({ error: { message: msg, code: 'all_providers_exhausted' } })
  };
}

// ─── Web Search: Serper → Brave → DuckDuckGo ─────────────────────────────────

async function searchWeb(query) {
  const serperKey = process.env.SERPER_API_KEY;
  const braveKey  = process.env.BRAVE_API_KEY;

  if (serperKey) {
    try {
      const resp = await fetch('https://google.serper.dev/search', {
        method:  'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q: query, num: 5 })
      });
      const data    = await resp.json();
      const results = [];
      if (data.answerBox) results.push({
        title:   data.answerBox.title || 'Answer',
        snippet: data.answerBox.answer || data.answerBox.snippet || '',
        url:     data.answerBox.link || ''
      });
      (data.organic || []).slice(0, 4).forEach(r =>
        results.push({ title: r.title, snippet: r.snippet || '', url: r.link })
      );
      if (results.length) {
        logger.info(`Serper: ${results.length} results for "${query}"`);
        return { results, source: 'Google' };
      }
    } catch (e) { logger.warn('Serper search failed: ' + e.message); }
  }

  if (braveKey) {
    try {
      const resp = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        { headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey } }
      );
      const data    = await resp.json();
      const results = (data.web?.results || []).slice(0, 5).map(r => ({
        title: r.title, snippet: r.description || '', url: r.url
      }));
      if (results.length) {
        logger.info(`Brave: ${results.length} results for "${query}"`);
        return { results, source: 'Brave Search' };
      }
    } catch (e) { logger.warn('Brave search failed: ' + e.message); }
  }

  try {
    const resp = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
    );
    const data    = await resp.json();
    const results = [];
    if (data.Answer)       results.push({ title: 'Quick Answer', snippet: data.Answer, url: '' });
    if (data.AbstractText) results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || '' });
    (data.RelatedTopics || []).slice(0, 5).forEach(t => {
      if (t.Text && t.FirstURL) results.push({ title: t.Text.slice(0, 80), snippet: t.Text, url: t.FirstURL });
    });
    if (results.length) {
      logger.info(`DuckDuckGo: ${results.length} results for "${query}"`);
      return { results, source: 'DuckDuckGo' };
    }
  } catch (e) { logger.warn('DuckDuckGo search failed: ' + e.message); }

  return { results: [], source: 'none' };
}

// ─── Search Intent Detection ──────────────────────────────────────────────────

function detectSearchIntent(message) {
  const msg = message.trim();
  if (/^(search|find|look\s*up|google|web\s*search)\s*[:\s]/i.test(msg))   return true;
  if (/\b(search for|look up|find me|search the web|browse for)\b/i.test(msg)) return true;
  if (/\b(latest|current|recent|today|right now|live)\b.{0,30}\b(news|price|version|update|status|score|weather)\b/i.test(msg)) return true;
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

// ─── Gemini Keys Accessor (for Vision) ───────────────────────────────────────

function getGeminiKey() {
  if (!_geminiKeys.length) return null;
  const key = _geminiKeys[_geminiKeyIdx % _geminiKeys.length];
  _geminiKeyIdx = (_geminiKeyIdx + 1) % _geminiKeys.length;
  return key;
}

function getGroqKey() {
  if (!_groqKeys.length) return null;
  return _groqKeys[_groqKeyIdx % _groqKeys.length];
}

module.exports = {
  callGroq, searchWeb,
  detectSearchIntent, extractSearchQuery,
  validateKeys, getGeminiKey, getGroqKey,
  GROQ_MODEL, GEMINI_MODEL, OPENROUTER_MODEL
};
