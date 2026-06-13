'use strict';

const { adapter, isDBConnected } = require('../utils/db');
const logger = require('../utils/logger');

// ─── Memory Type Patterns ─────────────────────────────────────────────────────
// Detects what kind of thing the user said and whether to remember it

const MEMORY_PATTERNS = [
  // Identity
  { re: /\bmy name is\s+(\w[\w\s]*)/i,        type: 'identity',    label: 'name' },
  { re: /\bi am\s+([\w][\w\s]{2,30})/i,        type: 'identity',    label: 'who_they_are' },
  { re: /\bcall me\s+(\w[\w\s]*)/i,            type: 'identity',    label: 'alias' },

  // Preferences — languages / tech
  { re: /\bi (like|love|prefer|enjoy)\s+(.+)/i, type: 'preference', label: 'like' },
  { re: /\bi (hate|dislike|don't like)\s+(.+)/i,type: 'preference', label: 'dislike' },
  { re: /\bi use\s+(.+)\s+for\s+(.+)/i,         type: 'tool',       label: 'tool_usage' },
  { re: /\bmy (favourite|favorite)\s+(.+)\s+is\s+(.+)/i, type: 'preference', label: 'favorite' },

  // Work / projects
  { re: /\bi('m| am) working on\s+(.+)/i,       type: 'project',    label: 'current_project' },
  { re: /\bmy project\s+(is|called)\s+(.+)/i,   type: 'project',    label: 'project_name' },

  // Goals
  { re: /\bi want to\s+(.+)/i,                  type: 'goal',       label: 'want' },
  { re: /\bmy goal is\s+(.+)/i,                 type: 'goal',       label: 'goal' },

  // Skills / domain
  { re: /\bi (know|learn|study|do)\s+(.+)/i,    type: 'skill',      label: 'skill' },
  { re: /\bi am a\s+(developer|programmer|engineer|designer|student|coder)(\s.+)?/i, type: 'role', label: 'profession' },
];

// ─── Extract Memory from a User Message ──────────────────────────────────────

function extractMemory(message) {
  const msg = String(message || '').trim();
  if (msg.length < 5) return null;

  for (const pattern of MEMORY_PATTERNS) {
    if (pattern.re.test(msg)) {
      return {
        type:    pattern.type,
        label:   pattern.label,
        content: msg.slice(0, 1000)  // store original message, max 1000 chars
      };
    }
  }
  return null;
}

// ─── Save Memory ──────────────────────────────────────────────────────────────

async function saveMemory(userId, type, content) {
  if (!userId || !type || !content) return false;
  try {
    const isDup = await adapter.memory.findRecent(userId, type, content);
    if (isDup) return true; // already saved recently

    await adapter.memory.insert(userId, type, content);
    logger.info(`Memory saved — user: ${userId} | type: ${type}`);
    return true;
  } catch (err) {
    logger.error('Memory save failed: ' + err.message);
    return false;
  }
}

// ─── Get Memory ───────────────────────────────────────────────────────────────

async function getMemory(userId, limit = 20) {
  if (!userId) return [];
  try {
    return await adapter.memory.findByUser(userId, limit);
  } catch (err) {
    logger.error('Memory fetch failed: ' + err.message);
    return [];
  }
}

// ─── Get Memory by Type ───────────────────────────────────────────────────────

async function getMemoryByType(userId, type) {
  if (!userId || !type) return [];
  try {
    return await adapter.memory.findByType(userId, type, 10);
  } catch (err) {
    logger.error('Memory type-fetch failed: ' + err.message);
    return [];
  }
}

// ─── Delete Memory ────────────────────────────────────────────────────────────

async function deleteMemory(userId, id) {
  try {
    return await adapter.memory.deleteById(userId, id);
  } catch (err) {
    logger.error('Memory delete failed: ' + err.message);
    return false;
  }
}

async function clearMemory(userId) {
  try {
    await adapter.memory.deleteByUser(userId);
    logger.info(`Memory cleared for user: ${userId}`);
    return true;
  } catch (err) {
    logger.error('Memory clear failed: ' + err.message);
    return false;
  }
}

// ─── Build Memory Context String (for AI prompt injection) ───────────────────
// Returns a formatted string ready to be inserted into the system prompt

async function getMemoryContext(userId) {
  const memories = await getMemory(userId, 20);
  if (!memories.length) return '';

  // Group by type for cleaner injection
  const grouped = {};
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type].push(m.content);
  }

  const lines = ['=== WHAT JARVIS KNOWS ABOUT THIS USER ==='];
  for (const [type, items] of Object.entries(grouped)) {
    lines.push(`[${type.toUpperCase()}]`);
    items.slice(0, 5).forEach(item => lines.push(`  - ${item}`));
  }
  lines.push('=== END USER MEMORY ===');

  return lines.join('\n');
}

// ─── Save Conversation Turn ───────────────────────────────────────────────────

async function saveConversationTurn(userId, role, content, sessionId = null) {
  if (!userId || !role || !content) return;
  try {
    await adapter.conversations.insert(userId, role, content, sessionId);
  } catch (err) {
    logger.error('Conversation save failed: ' + err.message);
  }
}

async function getConversationHistory(userId, limit = 10) {
  if (!userId) return [];
  try {
    return await adapter.conversations.findByUser(userId, limit);
  } catch (err) {
    logger.error('Conversation history fetch failed: ' + err.message);
    return [];
  }
}

module.exports = {
  extractMemory, saveMemory,
  getMemory, getMemoryByType, deleteMemory, clearMemory,
  getMemoryContext,
  saveConversationTurn, getConversationHistory
};
