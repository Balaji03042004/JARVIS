'use strict';

const os = require('os');
const { fetch: undicicFetch } = require('undici');

const logger          = require('../utils/logger');
const { readData }    = require('../utils/dataStore');
const { formatFileSize, fmtUptime } = require('../utils/helpers');
const {
  executeShellCommand, openAnyAppTarget, openInBrowser,
  getScannedApps
} = require('./systemService');

// ─── WhatsApp Config ──────────────────────────────────────────────────────────

const WA_API_VERSION       = process.env.WHATSAPP_API_VERSION || 'v21.0';
const WHATSAPP_PHONE_ID    = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_TOKEN       = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_VERIFY      = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_ENABLED     = !!(WHATSAPP_PHONE_ID && WHATSAPP_TOKEN && WHATSAPP_VERIFY);
const WHATSAPP_REQUIRE_CONFIRM  = String(process.env.WHATSAPP_REQUIRE_CONFIRM || 'true').toLowerCase() !== 'false';
const WHATSAPP_CONFIRM_WINDOW   = Number(process.env.WHATSAPP_CONFIRM_WINDOW_MS || 120000);
const WHATSAPP_ALLOWED_NUMBERS  = new Set(
  String(process.env.WHATSAPP_ALLOWED_NUMBERS || '').split(',').map(v => v.trim().replace(/[^\d]/g, '')).filter(Boolean)
);

// ─── Telegram Config ──────────────────────────────────────────────────────────

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_ALLOWED = new Set(
  String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

// ─── WhatsApp State ───────────────────────────────────────────────────────────

const _waPendingActions = new Map();
let _waPendingSeq = 1;

// ─── WhatsApp Site Map ────────────────────────────────────────────────────────

const WA_SITE_MAP = {
  google: 'https://www.google.com', youtube: 'https://www.youtube.com',
  gmail: 'https://mail.google.com', whatsapp: 'https://web.whatsapp.com',
  github: 'https://github.com', linkedin: 'https://www.linkedin.com',
  instagram: 'https://www.instagram.com', facebook: 'https://www.facebook.com',
  reddit: 'https://www.reddit.com', netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com', chatgpt: 'https://chatgpt.com',
  copilot: 'https://copilot.microsoft.com'
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeNumber(input) {
  return String(input || '').replace(/[^\d]/g, '');
}

function trimReply(text, maxLen = 1400) {
  const clean = String(text || '').replace(/\u0000/g, '').trim();
  return clean.length <= maxLen ? clean : clean.slice(0, maxLen - 12) + '\n...[truncated]';
}

function resolveWebTarget(raw) {
  const text = String(raw || '').trim();
  const low  = text.toLowerCase();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(text)) return `https://${text}`;
  if (WA_SITE_MAP[low]) return WA_SITE_MAP[low];
  return null;
}

// ─── Command Parser (shared: WhatsApp + Telegram) ─────────────────────────────

function parseCommand(input) {
  const text = String(input || '').trim();
  const low  = text.toLowerCase();
  if (!text)               return { type: 'empty' };
  if (/^help$/i.test(low)) return { type: 'help' };
  if (/^system\s+info$/i.test(low)) return { type: 'system_info' };
  if (/^list\s+apps?$/i.test(low))  return { type: 'list_apps' };

  const confirmMatch = low.match(/^confirm\s+(\d+)$/i);
  if (confirmMatch) return { type: 'confirm', id: confirmMatch[1] };

  const cancelMatch = low.match(/^cancel\s+(\d+)$/i);
  if (cancelMatch) return { type: 'cancel', id: cancelMatch[1] };

  const runMatch = text.match(/^run\s+(.+)$/i);
  if (runMatch) return { type: 'run_command', command: runMatch[1].trim() };

  const openAppMatch = text.match(/^open\s+app\s+(.+)$/i);
  if (openAppMatch) return { type: 'app_open', target: openAppMatch[1].trim() };

  const openSiteMatch = text.match(/^open\s+site\s+(.+)$/i);
  if (openSiteMatch) return { type: 'web_open', url: resolveWebTarget(openSiteMatch[1]) };

  const openMatch = text.match(/^open\s+(.+)$/i);
  if (openMatch) {
    const target = openMatch[1].trim();
    const webUrl = resolveWebTarget(target);
    if (webUrl) return { type: 'web_open', url: webUrl };
    return { type: 'app_open', target };
  }

  return { type: 'unknown' };
}

// ─── Command Executor ─────────────────────────────────────────────────────────

async function executeCommand(parsed) {
  if (parsed.type === 'help') {
    return { success: true, reply:
      'JARVIS Commands:\n\n- help\n- system info\n- list apps\n- open app <name>\n- open <app|site|domain>\n- open site <url/domain/name>\n- run <command>\n- confirm <id>\n- cancel <id>'
    };
  }

  if (parsed.type === 'system_info') {
    const total = os.totalmem(), free = os.freemem();
    const msg =
      `System:\nHost: ${os.hostname()}\nOS: ${os.type()} ${os.release()} (${os.arch()})\n` +
      `CPU Cores: ${os.cpus().length}\n` +
      `RAM: ${formatFileSize(total - free)} / ${formatFileSize(total)} (${Math.round(((total-free)/total)*100)}%)\n` +
      `Uptime: ${fmtUptime(os.uptime())}`;
    return { success: true, reply: msg };
  }

  if (parsed.type === 'list_apps') {
    const apps   = await getScannedApps();
    if (!apps.length) return { success: true, reply: 'No Start Menu apps were found.' };
    const sample = apps.slice(0, 40).map(a => `- ${a.name}`).join('\n');
    const more   = apps.length > 40 ? `\n...and ${apps.length - 40} more.` : '';
    return { success: true, reply: `Installed apps (${apps.length}):\n${sample}${more}` };
  }

  if (parsed.type === 'web_open') {
    if (!parsed.url) return { success: false, reply: 'Please provide a valid URL/domain/site name.' };
    const result = await openInBrowser(parsed.url, false);
    return result.success
      ? { success: true, reply: `Opened: ${result.url}` }
      : { success: false, reply: `Failed to open site: ${result.error}` };
  }

  if (parsed.type === 'app_open') {
    const result = await openAnyAppTarget(parsed.target);
    return result.success
      ? { success: true, reply: `Opened app: ${result.opened}` }
      : { success: false, reply: result.error || `Unable to open: ${parsed.target}` };
  }

  if (parsed.type === 'run_command') {
    const result = await executeShellCommand(parsed.command, 'powershell');
    if (!result.success) return { success: false, reply: `Command failed: ${result.error || 'Unknown error'}` };
    return { success: true, reply: `Done.\n\nCommand: ${result.command}\n\n${result.stdout || '(no output)'}` };
  }

  if (parsed.type === 'empty') return { success: true, reply: 'Send a command like: help' };

  return { success: false, reply: 'Unknown command. Send "help" to see supported commands.' };
}

// ─── WhatsApp Send ────────────────────────────────────────────────────────────

async function sendWhatsAppText(to, body) {
  if (!WHATSAPP_ENABLED) return { success: false, error: 'WhatsApp integration is disabled' };
  const url     = `https://graph.facebook.com/${WA_API_VERSION}/${WHATSAPP_PHONE_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to:   normalizeNumber(to),
    type: 'text',
    text: { body: trimReply(body) }
  };
  try {
    const resp = await undicicFetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { success: false, error: data?.error?.message || `HTTP ${resp.status}` };
    return { success: true, data };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── WhatsApp Incoming ────────────────────────────────────────────────────────

function _cleanupPendingWA() {
  const now = Date.now();
  for (const [id, item] of _waPendingActions.entries()) {
    if (now - item.createdAt > WHATSAPP_CONFIRM_WINDOW) _waPendingActions.delete(id);
  }
}

function _requiresConfirmation(parsed) {
  if (!WHATSAPP_REQUIRE_CONFIRM) return false;
  return parsed.type === 'run_command' || parsed.type === 'app_open';
}

function _queuePending(from, parsed) {
  const id = String(_waPendingSeq++);
  _waPendingActions.set(id, { id, from: normalizeNumber(from), parsed, createdAt: Date.now() });
  return id;
}

async function handleIncomingWhatsApp(from, text) {
  _cleanupPendingWA();
  const normalizedFrom = normalizeNumber(from);

  if (WHATSAPP_ALLOWED_NUMBERS.size && !WHATSAPP_ALLOWED_NUMBERS.has(normalizedFrom)) {
    await sendWhatsAppText(from, 'Access denied for this number.');
    return;
  }

  const parsed = parseCommand(text);

  if (parsed.type === 'confirm') {
    const pending = _waPendingActions.get(parsed.id);
    if (!pending) { await sendWhatsAppText(from, `No pending action found for id ${parsed.id}.`); return; }
    if (pending.from !== normalizedFrom) { await sendWhatsAppText(from, 'That action was created by another number.'); return; }
    if (Date.now() - pending.createdAt > WHATSAPP_CONFIRM_WINDOW) {
      _waPendingActions.delete(parsed.id);
      await sendWhatsAppText(from, `Action ${parsed.id} expired. Send command again.`);
      return;
    }
    _waPendingActions.delete(parsed.id);
    const result = await executeCommand(pending.parsed);
    await sendWhatsAppText(from, result.reply);
    return;
  }

  if (parsed.type === 'cancel') {
    const pending = _waPendingActions.get(parsed.id);
    if (!pending) { await sendWhatsAppText(from, `No pending action for id ${parsed.id}.`); return; }
    if (pending.from !== normalizedFrom) { await sendWhatsAppText(from, 'That action belongs to another number.'); return; }
    _waPendingActions.delete(parsed.id);
    await sendWhatsAppText(from, `Cancelled action ${parsed.id}.`);
    return;
  }

  if (_requiresConfirmation(parsed)) {
    const id      = _queuePending(from, parsed);
    const summary = parsed.type === 'run_command' ? `run command: ${parsed.command}` : `open app: ${parsed.target}`;
    await sendWhatsAppText(from,
      `Approval required for action #${id}: ${summary}\n\nReply: confirm ${id}\nOr: cancel ${id}\n\nExpires in ${Math.round(WHATSAPP_CONFIRM_WINDOW / 1000)} seconds.`
    );
    return;
  }

  const result = await executeCommand(parsed);
  await sendWhatsAppText(from, result.reply);
}

function getWhatsAppStatus() {
  return {
    enabled:           WHATSAPP_ENABLED,
    requireConfirm:    WHATSAPP_REQUIRE_CONFIRM,
    confirmWindowSec:  Math.round(WHATSAPP_CONFIRM_WINDOW / 1000),
    allowListCount:    WHATSAPP_ALLOWED_NUMBERS.size,
    pendingActions:    _waPendingActions.size
  };
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegramMsg(chatId, text) {
  if (!TELEGRAM_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096), parse_mode: 'Markdown' })
    });
  } catch {}
}

async function handleTelegramWebhook(body) {
  const { message } = body || {};
  if (!message) return;
  const chatId = String(message.chat?.id || '');
  const text   = String(message.text || '').trim();
  if (!chatId || !text) return;
  if (TELEGRAM_ALLOWED.size && !TELEGRAM_ALLOWED.has(chatId)) {
    await sendTelegramMsg(chatId, '🚫 Access denied.');
    return;
  }
  const parsed = parseCommand(text);
  const result = await executeCommand(parsed);
  await sendTelegramMsg(chatId, result.reply || (result.success ? '✅ Done' : '❌ Failed'));
}

function getTelegramStatus() {
  return { configured: !!TELEGRAM_TOKEN, allowedCount: TELEGRAM_ALLOWED.size };
}

module.exports = {
  parseCommand, executeCommand,
  sendWhatsAppText, handleIncomingWhatsApp, getWhatsAppStatus,
  WHATSAPP_ENABLED, WHATSAPP_VERIFY,
  sendTelegramMsg, handleTelegramWebhook, getTelegramStatus
};
