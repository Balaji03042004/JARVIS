'use strict';

const crypto = require('crypto');
const { readData, writeData } = require('../utils/dataStore');

// ─── Breach Check ─────────────────────────────────────────────────────────────

exports.breachCheck = async (req, res) => {
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') return res.status(400).json({ success: false, error: 'password required' });
  const hash   = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const resp  = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'User-Agent': 'JARVIS-BreachCheck/1.0', 'Add-Padding': 'true' },
      signal:  AbortSignal.timeout(8000)
    });
    const text  = await resp.text();
    const match = text.split('\n').find(l => l.toUpperCase().startsWith(suffix + ':'));
    const count = match ? parseInt(match.split(':')[1], 10) : 0;
    res.json({ success: true, pwned: count > 0, count });
  } catch (e) { res.json({ success: false, error: e.message }); }
};

// ─── Audit Log ────────────────────────────────────────────────────────────────

exports.getAuditLog = (req, res) => {
  res.json({ success: true, log: readData('audit-log.json').slice(-200) });
};

exports.appendAuditLog = (req, res) => {
  const { action, detail } = req.body || {};
  if (!action) return res.status(400).json({ success: false, error: 'action required' });
  const log = readData('audit-log.json');
  log.push({
    action:    String(action).slice(0, 200),
    detail:    String(detail || '').slice(0, 500),
    timestamp: new Date().toISOString()
  });
  if (log.length > 1000) log.splice(0, log.length - 1000);
  writeData('audit-log.json', log);
  res.json({ success: true });
};
