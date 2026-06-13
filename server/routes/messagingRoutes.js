'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/messagingController');

router.get('/whatsapp/webhook',   ctrl.whatsappVerify);
router.post('/whatsapp/webhook',  ctrl.whatsappWebhook);
router.get('/whatsapp/status',    ctrl.whatsappStatus);

router.get('/telegram/status',    ctrl.telegramStatus);
router.post('/telegram/webhook',  ctrl.telegramWebhook);
router.post('/telegram/send',     ctrl.telegramSend);

module.exports = router;
