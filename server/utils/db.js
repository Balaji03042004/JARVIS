'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — Dual Database Adapter
//
// Priority:  Supabase PostgreSQL (primary)  →  File-based JSON (fallback)
//
// Auto-detection:
//   - If SUPABASE_DB_URL or PG_HOST is set AND pg connects → use Supabase
//   - If pg is not installed, not configured, or connection fails → use fileDb
//   - No manual config needed — it just works either way
//
// All services use db.adapter.memory.*, db.adapter.conversations.* etc.
// Legacy pool.query is kept for any existing raw-SQL code.
// ═══════════════════════════════════════════════════════════════════════════════

const logger = require('./logger');
const fileDb = require('./fileDb');

// ─── Try to load pg (optional — may not be installed) ────────────────────────
let Pool = null;
try { Pool = require('pg').Pool; } catch { /* pg not installed — file-only mode */ }

// ─── PostgreSQL Pool (null if pg unavailable or not configured) ───────────────
let pool         = null;
let _pgConnected = false;
let _pgFailed    = false;

function _buildPool() {
  if (!Pool) return null;
  const connStr = process.env.SUPABASE_DB_URL;
  if (connStr) {
    return new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  }
  const host = process.env.PG_HOST;
  const user = process.env.PG_USER;
  const pass = process.env.PG_PASSWORD;
  const db   = process.env.PG_DATABASE || 'postgres';
  const port = parseInt(process.env.PG_PORT || '5432', 10);
  if (!host || !user) return null;
  return new Pool({ host, port, user, password: pass, database: db, ssl: { rejectUnauthorized: false } });
}

pool = _buildPool();

if (pool) {
  pool.on('connect', () => {
    _pgConnected = true;
    _pgFailed    = false;
    logger.info('Supabase PostgreSQL connected');
  });
  pool.on('error', (err) => {
    logger.warn('Supabase pool error — falling back to file DB: ' + err.message);
    _pgFailed = true;
  });
}

// ─── isDBConnected — live check ───────────────────────────────────────────────
async function isDBConnected() {
  if (!pool || _pgFailed) return false;
  try {
    await pool.query('SELECT 1');
    _pgConnected = true;
    return true;
  } catch {
    _pgFailed    = true;
    _pgConnected = false;
    return false;
  }
}

// ─── activeBackend ────────────────────────────────────────────────────────────
async function activeBackend() {
  return (await isDBConnected()) ? 'supabase' : 'file';
}

// ─── initDB — create tables in Supabase if reachable ─────────────────────────
async function initDB() {
  const pgOk = await isDBConnected();

  if (pgOk) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS jarvis_memory (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_memory_user ON jarvis_memory (user_id, created_at DESC)`);

      await pool.query(`CREATE TABLE IF NOT EXISTS jarvis_conversations (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
        session_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_user ON jarvis_conversations (user_id, created_at DESC)`);

      await pool.query(`CREATE TABLE IF NOT EXISTS jarvis_habits (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id TEXT NOT NULL, action_type TEXT NOT NULL,
        action_data TEXT DEFAULT '{}', hour_of_day SMALLINT NOT NULL,
        day_of_week SMALLINT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_habits_user ON jarvis_habits (user_id, action_type, created_at DESC)`);

      await pool.query(`CREATE TABLE IF NOT EXISTS jarvis_contacts (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
        label TEXT DEFAULT 'mobile', created_at TIMESTAMPTZ DEFAULT NOW())`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_user ON jarvis_contacts (user_id)`);

      logger.info('Supabase tables ready — backend: PostgreSQL');
    } catch (err) {
      logger.warn('Supabase table init error — switching to file DB: ' + err.message);
      _pgFailed = true;
      logger.info('File-based database active → d:\\nexus-app\\data\\');
    }
  } else {
    logger.info('Supabase not reachable — backend: file-based (d:\\nexus-app\\data\\)');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL ADAPTER  —  same API for both backends
// ═══════════════════════════════════════════════════════════════════════════════

const adapter = {

  // ── memory ─────────────────────────────────────────────────────────────────
  memory: {
    async findRecent(userId, type, content) {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `SELECT id FROM jarvis_memory WHERE user_id=$1 AND type=$2 AND content=$3
             AND created_at >= NOW() - INTERVAL '24 hours' LIMIT 1`,
            [userId, type, content]);
          return r.rows.length > 0;
        } catch { _pgFailed = true; }
      }
      return fileDb.memory.findRecent(userId, type, content);
    },

    async insert(userId, type, content) {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `INSERT INTO jarvis_memory (user_id, type, content) VALUES ($1,$2,$3) RETURNING *`,
            [userId, type, String(content).slice(0, 2000)]);
          return r.rows[0];
        } catch { _pgFailed = true; }
      }
      return fileDb.memory.insert(userId, type, content);
    },

    async findByUser(userId, limit = 20) {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `SELECT id, type, content, created_at FROM jarvis_memory
             WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
            [userId, limit]);
          return r.rows;
        } catch { _pgFailed = true; }
      }
      return fileDb.memory.findByUser(userId, limit);
    },

    async findByType(userId, type, limit = 10) {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `SELECT content, created_at FROM jarvis_memory
             WHERE user_id=$1 AND type=$2 ORDER BY created_at DESC LIMIT $3`,
            [userId, type, limit]);
          return r.rows;
        } catch { _pgFailed = true; }
      }
      return fileDb.memory.findByType(userId, type, limit);
    },

    async deleteById(userId, id) {
      if (await isDBConnected()) {
        try {
          await pool.query(`DELETE FROM jarvis_memory WHERE id=$1 AND user_id=$2`, [id, userId]);
          return true;
        } catch { _pgFailed = true; }
      }
      return fileDb.memory.deleteById(userId, id);
    },

    async deleteByUser(userId) {
      if (await isDBConnected()) {
        try {
          await pool.query(`DELETE FROM jarvis_memory WHERE user_id=$1`, [userId]);
          return true;
        } catch { _pgFailed = true; }
      }
      return fileDb.memory.deleteByUser(userId);
    }
  },

  // ── conversations ──────────────────────────────────────────────────────────
  conversations: {
    async insert(userId, role, content, sessionId = null) {
      if (await isDBConnected()) {
        try {
          await pool.query(
            `INSERT INTO jarvis_conversations (user_id, role, content, session_id) VALUES ($1,$2,$3,$4)`,
            [userId, role, String(content).slice(0, 8000), sessionId]);
          return true;
        } catch { _pgFailed = true; }
      }
      fileDb.conversations.insert(userId, role, content, sessionId);
      return true;
    },

    async findByUser(userId, limit = 20) {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `SELECT role, content, created_at FROM jarvis_conversations
             WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
            [userId, limit]);
          return r.rows.reverse();
        } catch { _pgFailed = true; }
      }
      return fileDb.conversations.findByUser(userId, limit);
    },

    async deleteByUser(userId) {
      if (await isDBConnected()) {
        try {
          await pool.query(`DELETE FROM jarvis_conversations WHERE user_id=$1`, [userId]);
          return true;
        } catch { _pgFailed = true; }
      }
      return fileDb.conversations.deleteByUser(userId);
    }
  },

  // ── habits ─────────────────────────────────────────────────────────────────
  habits: {
    async insert(userId, actionType, actionData, hourOfDay, dayOfWeek) {
      if (await isDBConnected()) {
        try {
          await pool.query(
            `INSERT INTO jarvis_habits (user_id, action_type, action_data, hour_of_day, day_of_week)
             VALUES ($1,$2,$3,$4,$5)`,
            [userId, actionType, actionData, hourOfDay, dayOfWeek]);
          return true;
        } catch { _pgFailed = true; }
      }
      fileDb.habits.insert(userId, actionType, actionData, hourOfDay, dayOfWeek);
      return true;
    },

    async aggregate(userId, daysBack = 30, filterType = null, filterHour = null) {
      if (await isDBConnected()) {
        try {
          let q = `SELECT action_type, action_data, hour_of_day, day_of_week, COUNT(*) as cnt
                   FROM jarvis_habits WHERE user_id=$1
                   AND created_at >= NOW() - INTERVAL '${daysBack} days'`;
          const params = [userId];
          if (filterType !== null) { q += ` AND action_type=$${params.length+1}`; params.push(filterType); }
          if (filterHour !== null) { q += ` AND hour_of_day=$${params.length+1}`; params.push(filterHour); }
          q += ' GROUP BY action_type, action_data, hour_of_day, day_of_week ORDER BY cnt DESC LIMIT 50';
          const r = await pool.query(q, params);
          return r.rows;
        } catch { _pgFailed = true; }
      }
      return fileDb.habits.aggregate(userId, daysBack, filterType, filterHour);
    },

    async countByType(userId, hoursBack = 24) {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `SELECT action_type, COUNT(*) as cnt FROM jarvis_habits
             WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '${hoursBack} hours'
             GROUP BY action_type ORDER BY cnt DESC`,
            [userId]);
          const total = r.rows.reduce((s, row) => s + parseInt(row.cnt), 0);
          return { total, byType: Object.fromEntries(r.rows.map(row => [row.action_type, parseInt(row.cnt)])) };
        } catch { _pgFailed = true; }
      }
      return fileDb.habits.countByType(userId, hoursBack);
    }
  },

  // ── contacts ──────────────────────────────────────────────────────────────
  contacts: {
    async findDuplicate(userId, phone) {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `SELECT id FROM jarvis_contacts WHERE user_id=$1 AND phone=$2 LIMIT 1`,
            [userId, phone]);
          return r.rows.length > 0 ? r.rows[0] : null;
        } catch { _pgFailed = true; }
      }
      return fileDb.contacts.findDuplicate(userId, phone);
    },

    async insert(userId, name, phone, label = 'mobile') {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `INSERT INTO jarvis_contacts (user_id, name, phone, label) VALUES ($1,$2,$3,$4) RETURNING *`,
            [userId, name.trim(), phone.trim(), label]);
          return r.rows[0];
        } catch { _pgFailed = true; }
      }
      return fileDb.contacts.insert(userId, name, phone, label);
    },

    async findByUser(userId) {
      if (await isDBConnected()) {
        try {
          const r = await pool.query(
            `SELECT id, name, phone, label FROM jarvis_contacts WHERE user_id=$1 ORDER BY name ASC`,
            [userId]);
          return r.rows;
        } catch { _pgFailed = true; }
      }
      return fileDb.contacts.findByUser(userId);
    },

    async deleteById(userId, id) {
      if (await isDBConnected()) {
        try {
          await pool.query(`DELETE FROM jarvis_contacts WHERE id=$1 AND user_id=$2`, [id, userId]);
          return true;
        } catch { _pgFailed = true; }
      }
      return fileDb.contacts.deleteById(userId, id);
    }
  }
};

module.exports = { pool, initDB, isDBConnected, activeBackend, adapter, fileDb };

