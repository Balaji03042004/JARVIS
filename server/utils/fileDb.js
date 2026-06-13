'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — File-Based Database Engine
// Mirrors every SQL table as a JSON file on disk.
// Drop-in replacement for Supabase/PostgreSQL — no npm packages required.
// ═══════════════════════════════════════════════════════════════════════════════
//
// Storage layout (d:\nexus-app\data\):
//   jarvis_memory.json
//   jarvis_conversations.json
//   jarvis_habits.json
//   jarvis_contacts.json
//
// Each file is an array of row objects. IDs are auto-incremented integers.
// All writes are atomic: write to .tmp → rename to .json (prevents corruption).
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// ─── Ensure data directory exists ────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── In-memory cache ─────────────────────────────────────────────────────────
// Keeps each table in RAM so reads are instant; writes go to disk.
const _cache = {};

// ─── Load table from disk ─────────────────────────────────────────────────────
function _load(table) {
  if (_cache[table]) return _cache[table];
  const file = path.join(DATA_DIR, `${table}.json`);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    _cache[table] = JSON.parse(raw);
  } catch {
    _cache[table] = [];
  }
  return _cache[table];
}

// ─── Persist table to disk (atomic write) ────────────────────────────────────
function _save(table) {
  const file = path.join(DATA_DIR, `${table}.json`);
  const tmp  = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(_cache[table], null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`[fileDb] Save failed for ${table}: ${err.message}`);
  }
}

// ─── Auto-increment ID ────────────────────────────────────────────────────────
function _nextId(rows) {
  if (!rows.length) return 1;
  return Math.max(...rows.map(r => r.id || 0)) + 1;
}

// ─── ISO timestamp ────────────────────────────────────────────────────────────
function _now() {
  return new Date().toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: jarvis_memory
// Columns: id, user_id, type, content, created_at
// ═══════════════════════════════════════════════════════════════════════════════

const memory = {
  /**
   * Check if a near-duplicate already exists within the last 24h
   */
  findRecent(userId, type, content) {
    const rows   = _load('jarvis_memory');
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return rows.some(r =>
      r.user_id === userId &&
      r.type    === type   &&
      r.content === content &&
      new Date(r.created_at).getTime() >= cutoff
    );
  },

  insert(userId, type, content) {
    const rows = _load('jarvis_memory');
    const row  = {
      id:         _nextId(rows),
      user_id:    userId,
      type:       type,
      content:    String(content).slice(0, 2000),
      created_at: _now()
    };
    rows.push(row);
    _save('jarvis_memory');
    return row;
  },

  findByUser(userId, limit = 20) {
    const rows = _load('jarvis_memory');
    return rows
      .filter(r => r.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },

  findByType(userId, type, limit = 10) {
    const rows = _load('jarvis_memory');
    return rows
      .filter(r => r.user_id === userId && r.type === type)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },

  deleteById(userId, id) {
    const rows = _load('jarvis_memory');
    const before = rows.length;
    _cache['jarvis_memory'] = rows.filter(r => !(r.id === Number(id) && r.user_id === userId));
    _save('jarvis_memory');
    return _cache['jarvis_memory'].length < before;
  },

  deleteByUser(userId) {
    const rows = _load('jarvis_memory');
    _cache['jarvis_memory'] = rows.filter(r => r.user_id !== userId);
    _save('jarvis_memory');
    return true;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: jarvis_conversations
// Columns: id, user_id, role, content, session_id, created_at
// ═══════════════════════════════════════════════════════════════════════════════

const conversations = {
  insert(userId, role, content, sessionId = null) {
    const rows = _load('jarvis_conversations');
    const row  = {
      id:         _nextId(rows),
      user_id:    userId,
      role:       role,
      content:    String(content).slice(0, 8000),
      session_id: sessionId,
      created_at: _now()
    };
    rows.push(row);

    // Hard cap at 2000 rows total — prune oldest when exceeded
    if (rows.length > 2000) {
      _cache['jarvis_conversations'] = rows.slice(rows.length - 2000);
    }
    _save('jarvis_conversations');
    return row;
  },

  findByUser(userId, limit = 20) {
    const rows = _load('jarvis_conversations');
    return rows
      .filter(r => r.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit)
      .reverse(); // oldest first for chat context
  },

  deleteByUser(userId) {
    _cache['jarvis_conversations'] = _load('jarvis_conversations').filter(r => r.user_id !== userId);
    _save('jarvis_conversations');
    return true;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: jarvis_habits
// Columns: id, user_id, action_type, action_data, hour_of_day, day_of_week, created_at
// ═══════════════════════════════════════════════════════════════════════════════

const habits = {
  insert(userId, actionType, actionData, hourOfDay, dayOfWeek) {
    const rows = _load('jarvis_habits');
    const row  = {
      id:          _nextId(rows),
      user_id:     userId,
      action_type: actionType,
      action_data: String(actionData).slice(0, 500),
      hour_of_day: hourOfDay,
      day_of_week: dayOfWeek,
      created_at:  _now()
    };
    rows.push(row);

    // Hard cap at 5000 rows — prune oldest
    if (rows.length > 5000) {
      _cache['jarvis_habits'] = rows.slice(rows.length - 5000);
    }
    _save('jarvis_habits');
    return row;
  },

  /**
   * Aggregate rows similar to the SQL GROUP BY queries.
   * Returns array of { action_type, action_data, hour_of_day, day_of_week, cnt }
   */
  aggregate(userId, daysBack = 30, filterType = null, filterHour = null) {
    const rows   = _load('jarvis_habits');
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    let filtered = rows.filter(r =>
      r.user_id === userId &&
      new Date(r.created_at) >= cutoff
    );

    if (filterType  !== null) filtered = filtered.filter(r => r.action_type === filterType);
    if (filterHour  !== null) filtered = filtered.filter(r => r.hour_of_day === filterHour);

    // Group
    const map = {};
    for (const r of filtered) {
      const key = `${r.action_type}|||${r.action_data}|||${r.hour_of_day}|||${r.day_of_week}`;
      if (!map[key]) map[key] = { action_type: r.action_type, action_data: r.action_data, hour_of_day: r.hour_of_day, day_of_week: r.day_of_week, cnt: 0 };
      map[key].cnt++;
    }

    return Object.values(map).sort((a, b) => b.cnt - a.cnt).slice(0, 50);
  },

  /**
   * Count by action_type within last N hours (for daily summary)
   */
  countByType(userId, hoursBack = 24) {
    const rows   = _load('jarvis_habits');
    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const filtered = rows.filter(r => r.user_id === userId && new Date(r.created_at) >= cutoff);

    const byType = {};
    for (const r of filtered) {
      byType[r.action_type] = (byType[r.action_type] || 0) + 1;
    }
    return { total: filtered.length, byType };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE: jarvis_contacts
// Columns: id, user_id, name, phone, label, created_at
// ═══════════════════════════════════════════════════════════════════════════════

const contacts = {
  findDuplicate(userId, phone) {
    const rows = _load('jarvis_contacts');
    return rows.find(r => r.user_id === userId && r.phone === phone) || null;
  },

  insert(userId, name, phone, label = 'mobile') {
    const rows = _load('jarvis_contacts');
    const row  = {
      id:         _nextId(rows),
      user_id:    userId,
      name:       name.trim(),
      phone:      phone.trim(),
      label:      label,
      created_at: _now()
    };
    rows.push(row);
    _save('jarvis_contacts');
    return row;
  },

  findByUser(userId) {
    const rows = _load('jarvis_contacts');
    return rows
      .filter(r => r.user_id === userId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  deleteById(userId, id) {
    const rows = _load('jarvis_contacts');
    _cache['jarvis_contacts'] = rows.filter(r => !(r.id === Number(id) && r.user_id === userId));
    _save('jarvis_contacts');
    return true;
  }
};

// ─── Utility: isConnected (always true for file-based DB) ────────────────────
function isConnected() { return true; }

// ─── Utility: stats for status endpoint ──────────────────────────────────────
function getStats() {
  return {
    memory:        (_load('jarvis_memory')).length,
    conversations: (_load('jarvis_conversations')).length,
    habits:        (_load('jarvis_habits')).length,
    contacts:      (_load('jarvis_contacts')).length,
    dataDir:       DATA_DIR
  };
}

module.exports = { memory, conversations, habits, contacts, isConnected, getStats };
