'use strict';

const logger        = require('../utils/logger');
const memoryService = require('../services/memoryService');
const { isDBConnected, activeBackend, fileDb } = require('../utils/db');

// ─── GET /api/memory — list all memories for a user ──────────────────────────
exports.getMemory = async (req, res) => {
  const userId = (req.query.userId || 'balaji').toLowerCase().replace(/\s+/g, '_');
  try {
    const memories = await memoryService.getMemory(userId, 50);
    res.json({ success: true, userId, count: memories.length, memories });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// ─── POST /api/memory — manually save a memory ───────────────────────────────
exports.saveMemory = async (req, res) => {
  const { userId = 'balaji', type, content } = req.body || {};
  if (!type || !content) return res.status(400).json({ success: false, error: 'type and content required' });
  const resolvedId = userId.toLowerCase().replace(/\s+/g, '_');
  const ok = await memoryService.saveMemory(resolvedId, type, content);
  res.json({ success: ok, userId: resolvedId });
};

// ─── DELETE /api/memory/:id — delete one memory ──────────────────────────────
exports.deleteMemory = async (req, res) => {
  const userId = (req.query.userId || 'balaji').toLowerCase().replace(/\s+/g, '_');
  const ok = await memoryService.deleteMemory(userId, req.params.id);
  res.json({ success: ok });
};

// ─── DELETE /api/memory — clear all memories for a user ──────────────────────
exports.clearMemory = async (req, res) => {
  const userId = (req.query.userId || 'balaji').toLowerCase().replace(/\s+/g, '_');
  const ok = await memoryService.clearMemory(userId);
  res.json({ success: ok, message: ok ? `All memories cleared for ${userId}` : 'DB not connected' });
};

// ─── GET /api/history — fetch conversation history for a user ────────────────
exports.getHistory = async (req, res) => {
  const userId = (req.query.userId || 'balaji').toLowerCase().replace(/\s+/g, '_');
  const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
  try {
    const history = await memoryService.getConversationHistory(userId, limit);
    res.json({ success: true, userId, history });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, history: [] });
  }
};

// ─── GET /api/memory/status — check DB connection ────────────────────────────
exports.status = async (req, res) => {
  const connected = await isDBConnected();
  res.json({ success: true, dbConnected: connected, message: connected ? 'PostgreSQL connected' : 'PostgreSQL not available' });
};
