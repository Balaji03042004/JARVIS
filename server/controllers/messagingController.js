'use strict';

const logger      = require('../utils/logger');
const messaging   = require('../services/messagingService');

// ─── WhatsApp Webhook Verification (GET) ──────────────────────────────────────

exports.whatsappVerify = (req, res) => {
  if (!messaging.WHATSAPP_ENABLED) return res.status(503).send('WhatsApp integration is disabled');
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === messaging.WHATSAPP_VERIFY) {
    logger.info('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Verification failed');
};

// ─── WhatsApp Incoming Messages (POST) ───────────────────────────────────────

exports.whatsappWebhook = async (req, res) => {
  if (!messaging.WHATSAPP_ENABLED) return res.status(200).json({ success: true, ignored: true });
  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const messages = change.value?.messages || [];
        for (const message of messages) {
          if (message.type !== 'text') continue;
          const from = message.from;
          const text = message.text?.body || '';
          if (!from || !text) continue;
          logger.info(`WhatsApp command from ${from}: ${text}`);
          await messaging.handleIncomingWhatsApp(from, text);
        }
      }
    }
  } catch (e) {
    logger.error('WhatsApp webhook error: ' + e.message);
  }
  res.status(200).json({ success: true });
};

// ─── WhatsApp Status ──────────────────────────────────────────────────────────

exports.whatsappStatus = (req, res) => {
  res.json({ success: true, ...messaging.getWhatsAppStatus() });
};

// ─── Telegram Status ──────────────────────────────────────────────────────────

exports.telegramStatus = (req, res) => {
  res.json(messaging.getTelegramStatus());
};

// ─── Telegram Webhook ────────────────────────────────────────────────────────

exports.telegramWebhook = async (req, res) => {
  res.sendStatus(200);
  await messaging.handleTelegramWebhook(req.body);
};

// ─── Telegram Send ────────────────────────────────────────────────────────────

exports.telegramSend = async (req, res) => {
  const { chatId, text } = req.body || {};
  if (!chatId || !text) return res.status(400).json({ success: false, error: 'chatId and text required' });
  await messaging.sendTelegramMsg(String(chatId), text);
  res.json({ success: true });
};
