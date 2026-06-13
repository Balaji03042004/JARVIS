'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/securityController');

router.post('/breach-check',  ctrl.breachCheck);
router.get('/audit-log',      ctrl.getAuditLog);
router.post('/audit-log',     ctrl.appendAuditLog);

module.exports = router;
