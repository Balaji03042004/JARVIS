'use strict';

const DOC_CHUNK_SIZE           = 1200;
const DOC_CHUNK_OVERLAP        = 200;
const MAX_PROMPT_DOC_CHARS     = 6000;
const MAX_PROMPT_HISTORY_MSGS  = 10;
const MAX_PROMPT_MSG_CHARS     = 1800;

// ─── Size / Time Formatting ───────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '<1m';
}

// ─── Text Normalization ───────────────────────────────────────────────────────

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

const STOP_WORDS = new Set([
  'the','and','for','with','this','that','from','into','your','have','what',
  'when','where','which','will','would','there','their','about','could',
  'should','only','need','give','tell','show'
]);

function tokenizeQuery(text) {
  return [...new Set(
    normalizeText(text).toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t))
  )];
}

// ─── Document Chunking ────────────────────────────────────────────────────────

function buildDocChunks(text) {
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
    if (snippet) chunks.push({ text: snippet, offsetStart: start, offsetEnd: end });
    if (end >= clean.length) break;
    start = Math.max(end - DOC_CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

function scoreChunk(chunkText, queryTokens, rawQuery) {
  const haystack = normalizeText(chunkText).toLowerCase();
  if (!haystack) return 0;
  let score = 0;
  queryTokens.forEach(t => { if (haystack.includes(t)) score += t.length > 6 ? 3 : 2; });
  const nq = normalizeText(rawQuery).toLowerCase();
  if (nq && haystack.includes(nq)) score += 8;
  if (/definition|summary|overview|explain/.test(nq)) score += 1;
  return score;
}

// ─── Message + Document Context Trimming ─────────────────────────────────────

function trimMessagesForModel(messages) {
  return (messages || []).slice(-MAX_PROMPT_HISTORY_MSGS).map(msg => ({
    role:    msg.role,
    content: String(msg.content || '').slice(0, MAX_PROMPT_MSG_CHARS)
  }));
}

function getRelevantDocumentContext(docs, userQuery) {
  const queryTokens = tokenizeQuery(userQuery);
  let remaining = MAX_PROMPT_DOC_CHARS;

  const ranked = docs.flatMap(doc => {
    const chunks = Array.isArray(doc.chunks) && doc.chunks.length
      ? doc.chunks : buildDocChunks(doc.text);
    return chunks.map(chunk => ({
      doc, chunk, score: scoreChunk(chunk.text, queryTokens, userQuery)
    }));
  });

  ranked.sort((a, b) => b.score - a.score || a.chunk.offsetStart - b.chunk.offsetStart);

  const chosen = [], pickedKeys = new Set();
  for (const item of ranked) {
    if (remaining < 500) break;
    const key = `${item.doc.id}:${item.chunk.offsetStart}`;
    if (pickedKeys.has(key)) continue;
    if (item.score <= 0 && chosen.length >= 3) continue;
    const excerpt = item.chunk.text.slice(0, Math.min(item.chunk.text.length, remaining));
    if (excerpt.length < 120) continue;
    chosen.push({
      name:        item.doc.name,
      offsetStart: item.chunk.offsetStart,
      offsetEnd:   item.chunk.offsetEnd,
      text:        excerpt,
      score:       item.score
    });
    pickedKeys.add(key);
    remaining -= excerpt.length;
  }
  return chosen;
}

module.exports = {
  formatFileSize, fmtUptime,
  normalizeText, tokenizeQuery,
  buildDocChunks, scoreChunk,
  trimMessagesForModel, getRelevantDocumentContext,
  DOC_CHUNK_SIZE, DOC_CHUNK_OVERLAP, MAX_PROMPT_DOC_CHARS
};
