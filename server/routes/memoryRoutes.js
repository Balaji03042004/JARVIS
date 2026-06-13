'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/memoryController');

router.get('/memory/status', ctrl.status);
router.get('/history',       ctrl.getHistory);      // GET /api/history?userId=&limit=
router.get('/memory',        ctrl.getMemory);
router.post('/memory',       ctrl.saveMemory);
router.delete('/memory/:id', ctrl.deleteMemory);
router.delete('/memory',     ctrl.clearMemory);

module.exports = router;
