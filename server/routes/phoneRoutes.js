'use strict';

const router = require('express').Router();
const c      = require('../controllers/phoneController');

// Connection
router.post('/phone/connect',  c.connectPhone);   // pair phone via ADB WiFi
router.get('/phone/status',    c.phoneStatus);    // is phone connected?

// Calls
router.post('/phone/call',     c.makeCall);       // call by number or contact name
router.post('/phone/end-call', c.endCall);        // hang up

// Contacts
router.get('/phone/contacts',       c.getContacts);    // list all contacts
router.post('/phone/contacts',      c.addContact);     // add one contact manually
router.delete('/phone/contacts/:id',c.deleteContact);  // delete contact
router.post('/phone/sync',          c.syncContacts);   // sync from phone via ADB

module.exports = router;
