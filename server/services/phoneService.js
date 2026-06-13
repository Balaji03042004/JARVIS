'use strict';

// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS Phone Service — ADB WiFi                         ║
// ║  Makes calls via Android Debug Bridge over WiFi          ║
// ║  No cost — uses phone's native dialer                    ║
// ╚══════════════════════════════════════════════════════════╝

const { exec } = require('child_process');
const { promisify } = require('util');
const { adapter } = require('../utils/db');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

// ─── ADB Helper ──────────────────────────────────────────────────────────────

async function adb(args) {
  const cmd = `adb ${args}`;
  logger.info(`ADB: ${cmd}`);
  const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
  return (stdout || '').trim();
}

// ─── Connection ───────────────────────────────────────────────────────────────

async function connectPhone(ip, port = 5555) {
  try {
    const out = await adb(`connect ${ip}:${port}`);
    const connected = out.includes('connected');
    return { success: connected, message: out };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function getConnectedDevices() {
  try {
    const out = await adb('devices');
    const lines = out.split('\n').slice(1).filter(l => l.includes('\tdevice'));
    return lines.map(l => l.split('\t')[0]);
  } catch {
    return [];
  }
}

async function isPhoneConnected() {
  const devices = await getConnectedDevices();
  return devices.length > 0;
}

// ─── Make a Call ─────────────────────────────────────────────────────────────

async function makeCall(phoneNumber) {
  // Clean the number — remove spaces, dashes, brackets
  const clean = String(phoneNumber).replace(/[\s\-().+]/g, '').replace(/^0/, '');
  if (!/^\d{7,15}$/.test(clean)) {
    return { success: false, message: `Invalid phone number: ${phoneNumber}` };
  }

  const connected = await isPhoneConnected();
  if (!connected) {
    return {
      success: false,
      message: 'Phone not connected via ADB. Connect first using /api/phone/connect'
    };
  }

  try {
    // Open Android dialer with number
    await adb(`shell am start -a android.intent.action.CALL -d tel:${clean}`);
    logger.info(`Call initiated to ${clean}`);
    return { success: true, message: `Calling ${phoneNumber}`, number: clean };
  } catch (err) {
    return { success: false, message: `Call failed: ${err.message}` };
  }
}

// ─── End Current Call ────────────────────────────────────────────────────────

async function endCall() {
  try {
    // Send KEYCODE_ENDCALL (6)
    await adb('shell input keyevent 6');
    return { success: true, message: 'Call ended' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── Contacts (stored in Supabase) ───────────────────────────────────────────
// Contacts are synced once from phone and stored in jarvis_contacts table

async function saveContact(userId, name, phone, label = 'mobile') {
  const existing = await adapter.contacts.findDuplicate(userId, phone);
  if (existing) return { skipped: true };
  await adapter.contacts.insert(userId, name, phone, label);
  return { saved: true };
}

async function getContacts(userId) {
  return adapter.contacts.findByUser(userId);
}

async function deleteContact(userId, id) {
  return adapter.contacts.deleteById(userId, id);
}

// ─── Find Contact by Name (fuzzy) ────────────────────────────────────────────
// Used by JARVIS when user says "call Priya" — finds best match

async function findContactByName(userId, name) {
  const contacts = await getContacts(userId);
  if (!contacts.length) return null;

  const q = name.toLowerCase().trim();

  // Exact match first
  const exact = contacts.find(c => c.name.toLowerCase() === q);
  if (exact) return exact;

  // Starts-with match
  const starts = contacts.find(c => c.name.toLowerCase().startsWith(q));
  if (starts) return starts;

  // Contains match
  const contains = contacts.find(c => c.name.toLowerCase().includes(q));
  if (contains) return contains;

  return null;
}

// ─── Sync Contacts from Phone via ADB ────────────────────────────────────────
// Pulls contact list from Android phone using content provider

async function syncContactsFromPhone(userId) {
  const connected = await isPhoneConnected();
  if (!connected) {
    return { success: false, message: 'Phone not connected. Connect first.' };
  }

  try {
    // Query Android contacts content provider
    const out = await adb(
      `shell content query --uri content://com.android.contacts/data/phones --projection display_name:number`
    );

    const lines = out.split('\n').filter(l => l.includes('display_name='));
    let saved = 0, skipped = 0;

    for (const line of lines) {
      const nameMatch  = line.match(/display_name=([^,]+)/);
      const phoneMatch = line.match(/number=([^,}\s]+)/);
      if (!nameMatch || !phoneMatch) continue;

      const name  = nameMatch[1].trim();
      const phone = phoneMatch[1].replace(/[^0-9+]/g, '');
      if (!name || !phone) continue;

      const result = await saveContact(userId, name, phone);
      result.skipped ? skipped++ : saved++;
    }

    return { success: true, saved, skipped, total: saved + skipped };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── Parse Call Intent from Message ──────────────────────────────────────────
// Used by chatService to detect "call X" commands

const CALL_INTENT_RE = /\b(call|dial|phone|ring)\s+([a-zA-Z][\w\s]{1,30}?)(?:\s+(?:now|please|for me))?\s*$/i;
const END_CALL_RE    = /\b(end|stop|hang up|disconnect|cut)\s+(call|the call|phone)\b/i;

function parseCallIntent(message) {
  if (END_CALL_RE.test(message)) {
    return { action: 'end_call' };
  }
  const m = message.match(CALL_INTENT_RE);
  if (m) {
    return { action: 'call', name: m[2].trim() };
  }
  return null;
}

module.exports = {
  connectPhone,
  getConnectedDevices,
  isPhoneConnected,
  makeCall,
  endCall,
  saveContact,
  getContacts,
  deleteContact,
  findContactByName,
  syncContactsFromPhone,
  parseCallIntent,
};
