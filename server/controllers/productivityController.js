'use strict';

const logger      = require('../utils/logger');
const newsService = require('../services/newsService');
const aiService   = require('../services/aiService');
const { readData, writeData } = require('../utils/dataStore');

// ─── Reminders ────────────────────────────────────────────────────────────────

exports.getReminders = (req, res) => {
  res.json({ success: true, reminders: readData('reminders.json') });
};

exports.createReminder = (req, res) => {
  const { text, dueAt } = req.body || {};
  if (!text) return res.status(400).json({ success: false, error: 'text required' });
  const list = readData('reminders.json');
  const item = {
    id: Date.now().toString(), text: String(text).slice(0, 500),
    dueAt: dueAt || null, createdAt: new Date().toISOString(), fired: false
  };
  list.push(item);
  writeData('reminders.json', list);
  res.json({ success: true, reminder: item });
};

exports.deleteReminder = (req, res) => {
  writeData('reminders.json', readData('reminders.json').filter(r => r.id !== req.params.id));
  res.json({ success: true });
};

exports.markReminderFired = (req, res) => {
  const list = readData('reminders.json');
  const r    = list.find(x => x.id === req.params.id);
  if (r) { r.fired = true; writeData('reminders.json', list); }
  res.json({ success: true });
};

// ─── Notes ────────────────────────────────────────────────────────────────────

exports.getNotes = (req, res) => {
  res.json({ success: true, notes: readData('notes.json') });
};

exports.createNote = (req, res) => {
  const { title, content, tags } = req.body || {};
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  const list = readData('notes.json');
  const note = {
    id:        Date.now().toString(),
    title:     String(title).slice(0, 200),
    content:   String(content || '').slice(0, 50000),
    tags:      Array.isArray(tags) ? tags.map(t => String(t).slice(0, 50)) : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  list.unshift(note);
  writeData('notes.json', list);
  res.json({ success: true, note });
};

exports.updateNote = (req, res) => {
  const list = readData('notes.json');
  const idx  = list.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'not found' });
  const { title, content, tags } = req.body || {};
  if (title   !== undefined) list[idx].title   = String(title).slice(0, 200);
  if (content !== undefined) list[idx].content = String(content).slice(0, 50000);
  if (tags    !== undefined) list[idx].tags    = Array.isArray(tags) ? tags : [];
  list[idx].updatedAt = new Date().toISOString();
  writeData('notes.json', list);
  res.json({ success: true, note: list[idx] });
};

exports.deleteNote = (req, res) => {
  writeData('notes.json', readData('notes.json').filter(n => n.id !== req.params.id));
  res.json({ success: true });
};

// ─── News ─────────────────────────────────────────────────────────────────────

exports.getNews = async (req, res) => {
  const cat = newsService.RSS_FEEDS[req.query.category] ? req.query.category : 'tech';
  try {
    const items = await newsService.getNews(cat);
    res.json({ success: true, items, category: cat });
  } catch (e) { res.json({ success: false, error: e.message }); }
};

exports.getNewsContext = async (req, res) => {
  const cats = req.query.categories
    ? String(req.query.categories).split(',').map(s => s.trim()).filter(s => newsService.RSS_FEEDS[s])
    : ['tech', 'world', 'business'];
  try {
    const context = await newsService.getNewsSummaryContext(cats);
    res.json({ success: true, context });
  } catch (e) { res.json({ success: false, error: e.message }); }
};

// ─── Web Search ───────────────────────────────────────────────────────────────

exports.search = async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, error: 'Missing query' });
  try {
    const { results, source } = await aiService.searchWeb(query);
    res.json({ success: true, query, source, results, count: results.length });
  } catch (error) {
    logger.error('Search error: ' + error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
