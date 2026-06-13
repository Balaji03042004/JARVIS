'use strict';

const router = require('express').Router();
const c      = require('../controllers/browserController');

router.get('/browser/status',    c.status);    // extension connected? current page?
router.post('/browser/command',  c.command);   // generic: { action, data }
router.post('/browser/navigate', c.navigate);  // { url }
router.post('/browser/youtube',  c.youtube);   // { action, data }

module.exports = router;
