// ╔══════════════════════════════════════════════════════════╗
// ║   JARVIS — MODULAR SERVER ENTRY POINT                    ║
// ║   Architecture: Modular Monolith                         ║
// ║   Routes → Controllers → Services → Utils               ║
// ╚══════════════════════════════════════════════════════════╝

require('dotenv').config();

// Disable SSL certificate validation for external APIs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// ─── Services ────────────────────────────────────────────────────────────────
const { validateKeys }    = require('./server/services/aiService');
const { initDB }          = require('./server/utils/db');
const browserService      = require('./server/services/browserService');

// ─── Routes ──────────────────────────────────────────────────────────────────
const chatRoutes         = require('./server/routes/chatRoutes');
const systemRoutes       = require('./server/routes/systemRoutes');
const fileRoutes         = require('./server/routes/fileRoutes');
const mediaRoutes        = require('./server/routes/mediaRoutes');
const productivityRoutes = require('./server/routes/productivityRoutes');
const securityRoutes     = require('./server/routes/securityRoutes');
const messagingRoutes    = require('./server/routes/messagingRoutes');
const featureRoutes      = require('./server/routes/featureRoutes');
const memoryRoutes       = require('./server/routes/memoryRoutes');
const phoneRoutes        = require('./server/routes/phoneRoutes');
const cameraRoutes       = require('./server/routes/cameraRoutes');
const browserRoutes      = require('./server/routes/browserRoutes');
const integrationRoutes  = require('./server/routes/integrationRoutes');

// ─── Validate API Keys ───────────────────────────────────────────────────────
validateKeys();

// ─── Init Database (non-blocking) ────────────────────────────────────────────
initDB();

// ─── App Setup ───────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK', architecture: 'modular' }));

// ─── Mount All Routes ────────────────────────────────────────────────────────
app.use('/api', chatRoutes);         // /api/chat, /api/tts, /api/transcribe, /api/vision, /api/image-gen
app.use('/api', systemRoutes);       // /api/system-info, /api/run-command, /api/apps/*, /api/windows, /api/git, ...
app.use('/api', fileRoutes);         // /api/filesystem, /api/documents, /api/upload-document, /api/develop-feature, ...
app.use('/api', mediaRoutes);        // /api/music, /api/spotify, /api/youtube-search, /api/browse
app.use('/api', productivityRoutes); // /api/reminders, /api/notes, /api/news, /api/search
app.use('/api', securityRoutes);     // /api/breach-check, /api/audit-log
app.use('/api', messagingRoutes);    // /api/whatsapp/*, /api/telegram/*
app.use('/api', featureRoutes);      // /api/profile/save, /api/features/*
app.use('/api', memoryRoutes);       // /api/memory, /api/memory/status
app.use('/api', phoneRoutes);        // /api/phone/*
app.use('/api', cameraRoutes);       // /api/camera/*
app.use('/api', browserRoutes);      // /api/browser/*
app.use('/api', integrationRoutes);  // /api/spotify/*, /api/github/*, /api/habits/*

// ─── Start Server ────────────────────────────────────────────────────────────
// Uses http.createServer so WebSocket can share port 3000
const http = require('http');
const httpServer = http.createServer(app);

// Init Browser WebSocket (Chrome Extension bridge)
browserService.initBrowserWS(httpServer);

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║   JARVIS — MODULAR SERVER STARTED 🚀                    ║');
  console.log(`  ║   Open  : http://localhost:${PORT}                           ║`);
  console.log('  ║                                                          ║');
  console.log('  ║   Architecture: Modular Monolith                        ║');
  console.log('  ║   ├── server/routes/      — API endpoint definitions    ║');
  console.log('  ║   ├── server/controllers/ — Request/response handlers   ║');
  console.log('  ║   ├── server/services/    — Business logic (the brain)  ║');
  console.log('  ║   └── server/utils/       — Shared utilities            ║');
  console.log('  ║                                                          ║');
  console.log('  ║   Services Active:                                       ║');
  console.log('  ║   ✓ AI Service       (Groq → Gemini → OpenRouter)       ║');
  console.log('  ║   ✓ Chat Service     (Prompt building + injection)      ║');
  console.log('  ║   ✓ System Service   (Shell, Apps, Processes, Git)      ║');
  console.log('  ║   ✓ File Service     (Filesystem + Document store)      ║');
  console.log('  ║   ✓ Media Service    (Music, Spotify, YouTube)          ║');
  console.log('  ║   ✓ News Service     (BBC RSS feeds)                    ║');
  console.log('  ║   ✓ Security Service (BreachCheck, AuditLog)            ║');
  console.log('  ║   ✓ Messaging        (WhatsApp + Telegram bots)         ║');
  console.log('  ║   ✓ Memory Service   (PostgreSQL — persistent memory)   ║');
  console.log('  ║   ✓ Phone Service    (ADB WiFi — Android calls)         ║');
  console.log('  ║   ✓ Camera Service   (ffmpeg — webcam control)          ║');
  console.log('  ║   ✓ Browser Service  (Chrome Extension — WebSocket)     ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
});
