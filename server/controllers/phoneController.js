'use strict';

const phoneService = require('../services/phoneService');
const logger       = require('../utils/logger');

// POST /api/phone/connect  { ip, port }
async function connectPhone(req, res) {
  const { ip, port = 5555 } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip is required' });
  const result = await phoneService.connectPhone(ip, port);
  res.json(result);
}

// GET /api/phone/status
async function phoneStatus(req, res) {
  const devices = await phoneService.getConnectedDevices();
  res.json({ connected: devices.length > 0, devices });
}

// POST /api/phone/call  { number } or { name, userId }
async function makeCall(req, res) {
  try {
    const { number, name, userId = 'balaji' } = req.body;

    if (name) {
      // Look up by contact name
      const contact = await phoneService.findContactByName(userId, name);
      if (!contact) {
        return res.status(404).json({ error: `No contact found for "${name}"` });
      }
      const result = await phoneService.makeCall(contact.phone);
      return res.json({ ...result, contact });
    }

    if (number) {
      const result = await phoneService.makeCall(number);
      return res.json(result);
    }

    res.status(400).json({ error: 'Provide number or name' });
  } catch (err) {
    logger.error('makeCall error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/phone/end-call
async function endCall(req, res) {
  const result = await phoneService.endCall();
  res.json(result);
}

// ── Contacts ────────────────────────────────────────────────────────────────

// GET /api/phone/contacts?userId=balaji
async function getContacts(req, res) {
  try {
    const userId = req.query.userId || 'balaji';
    const contacts = await phoneService.getContacts(userId);
    res.json({ contacts, total: contacts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/phone/contacts  { userId, name, phone, label }
async function addContact(req, res) {
  try {
    const { userId = 'balaji', name, phone, label } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
    const result = await phoneService.saveContact(userId, name, phone, label);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/phone/contacts/:id?userId=balaji
async function deleteContact(req, res) {
  try {
    const userId = req.query.userId || 'balaji';
    await phoneService.deleteContact(userId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/phone/sync  { userId }
async function syncContacts(req, res) {
  try {
    const userId = req.body.userId || 'balaji';
    const result = await phoneService.syncContactsFromPhone(userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  connectPhone,
  phoneStatus,
  makeCall,
  endCall,
  getContacts,
  addContact,
  deleteContact,
  syncContacts,
};
