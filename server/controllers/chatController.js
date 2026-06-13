'use strict';

const os = require('os');

const logger           = require('../utils/logger');
const { trimMessagesForModel } = require('../utils/helpers');
const aiService        = require('../services/aiService');
const chatService      = require('../services/chatService');
const phoneService     = require('../services/phoneService');
const cameraService    = require('../services/cameraService');
const browserService   = require('../services/browserService');
const spotifyService   = require('../services/spotifyService');
const githubService    = require('../services/githubService');
const habitService     = require('../services/habitService');
const intentChainService = require('../services/intentChainService');
const { documentStore } = require('../services/fileService');

// ─── POST /api/chat ───────────────────────────────────────────────────────────

exports.chat = async (req, res) => {
  try {
    const { system, messages, max_tokens, userProfile, language, isBoss, customInstructions, clientTime, documentIds, emotionData } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    const compactMessages = trimMessagesForModel(messages);

    // Derive a stable user ID from the profile name
    const userId = (userProfile?.name || 'balaji').toLowerCase().replace(/\s+/g, '_');

    // ── Load DB conversation history when frontend starts fresh ─────────────
    // If the frontend has ≤ 2 messages it means the page was just loaded/refreshed.
    // Pull the last 20 turns from Supabase and prepend them so the AI has memory.
    const memoryService = require('../services/memoryService');
    if (compactMessages.length <= 2) {
      try {
        const dbHistory = await memoryService.getConversationHistory(userId, 20);
        if (dbHistory.length > 0) {
          // Map DB rows to OpenAI-format messages (skip duplicates of the current message)
          const historicMsgs = dbHistory
            .filter(h => h.content !== lastMsg) // avoid echoing the current message
            .map(h => ({ role: h.role, content: h.content }));
          // Prepend DB history before the current compactMessages
          compactMessages.unshift(...historicMsgs);
        }
      } catch (_) { /* non-critical — continue without history */ }
    }

    // ── Intent Chain Detection — "open X and play Y then do Z" ─────────────
    const chainSegments = intentChainService.parseChain(lastMsg);
    if (chainSegments.length >= 2) {
      const { results, hasAI, aiParts } = await intentChainService.executeChain(chainSegments, userId);
      let chainReply = results.join('\n');

      // If some segments need AI, call once with all AI parts combined
      if (hasAI) {
        const aiQuestion = aiParts.join('. ');
        const { systemPrompt } = await chatService.buildSystemPrompt({
          system, userProfile, language, isBoss, customInstructions, clientTime,
          documentIds, documentStore, compactMessages, userId, emotionData
        });
        const aiResp = await aiService.callGroq({
          model: aiService.GROQ_MODEL,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: aiQuestion }],
          max_tokens: 512, temperature: 0.7
        });
        if (aiResp.ok) {
          const aiData  = await aiResp.json();
          const aiReply = aiData?.choices?.[0]?.message?.content || '';
          chainReply = chainReply ? `${chainReply}\n${aiReply}` : aiReply;
        }
      }

      // Track habit
      habitService.trackAction(userId, habitService.ACTION_TYPES.SYSTEM, { chain: true, segments: chainSegments.length }).catch(() => {});

      return res.json({ content: [{ type: 'text', text: chainReply || 'Done, Boss.' }] });
    }

    // ── Spotify Intent Detection ─────────────────────────────────────────────
    const spotifyIntent = spotifyService.parseSpotifyIntent(lastMsg);
    if (spotifyIntent) {
      const result = await spotifyService.handleIntent(spotifyIntent);
      if (spotifyIntent.action.startsWith('play')) {
        habitService.trackAction(userId, habitService.ACTION_TYPES.MUSIC_PLAY, { query: spotifyIntent.query }).catch(() => {});
      }
      return res.json({ content: [{ type: 'text', text: result.reply }] });
    }

    // ── GitHub Intent Detection ──────────────────────────────────────────────
    const githubIntent = githubService.parseGitHubIntent(lastMsg);
    if (githubIntent) {
      const result = await githubService.handleIntent(githubIntent);
      return res.json({ content: [{ type: 'text', text: result.reply }] });
    }

    // ── Phone Call Intent Detection ─────────────────────────────────────────
    const lastMsg = compactMessages[compactMessages.length - 1]?.content || '';
    const callIntent = phoneService.parseCallIntent(lastMsg);
    if (callIntent) {
      if (callIntent.action === 'end_call') {
        const result = await phoneService.endCall();
        return res.json({ content: [{ type: 'text', text: result.success ? 'Call ended, Boss.' : `Couldn't end call: ${result.message}` }] });
      }
      if (callIntent.action === 'call') {
        const contact = await phoneService.findContactByName(userId, callIntent.name);
        if (contact) {
          const result = await phoneService.makeCall(contact.phone);
          const reply = result.success
            ? `Calling ${contact.name} (${contact.phone}), Boss.`
            : `Couldn't make the call: ${result.message}`;
          return res.json({ content: [{ type: 'text', text: reply }] });
        } else {
          return res.json({ content: [{ type: 'text', text: `I don't have a contact named "${callIntent.name}", Boss. Add them via the contacts API or say the number directly.` }] });
        }
      }
    }

    // ── Camera Intent Detection ─────────────────────────────────────────────
    const cameraIntent = cameraService.parseCameraIntent(lastMsg);
    if (cameraIntent) {
      let result, reply;
      switch (cameraIntent.action) {
        case 'open_app':
          result = await cameraService.openCameraApp();
          reply  = result.success ? 'Windows Camera app opened, Boss.' : `Couldn't open camera: ${result.message}`;
          break;

        case 'capture':
          result = await cameraService.captureImage();
          if (result.success) {
            reply = `Photo captured, Boss. View it at: http://localhost:3000${result.url}`;
          } else {
            reply = `Capture failed: ${result.message}`;
          }
          break;

        case 'start_recording':
          result = await cameraService.startRecording(cameraIntent.duration || 0);
          reply  = result.success ? result.message : `Recording failed: ${result.message}`;
          break;

        case 'stop_recording':
          result = await cameraService.stopRecording();
          reply  = result.success ? `${result.message} View at: http://localhost:3000${result.url}` : result.message;
          break;

        case 'list':
          const files = cameraService.getCapturedFiles();
          reply = files.length
            ? `You have ${files.length} captured file(s), Boss:\n` + files.slice(0, 10).map(f => `• ${f.filename} (${f.type})`).join('\n')
            : 'No captures yet, Boss. Say "take a photo" to start.';
          break;

        case 'list_cameras':
          const cameras = await cameraService.listCameras();
          reply = cameras.length
            ? `Available cameras:\n` + cameras.map((c, i) => `${i + 1}. ${c}`).join('\n')
            : 'No cameras detected. Check if webcam is connected.';
          break;

        case 'status':
          const rec = cameraService.getRecordingStatus();
          const ff  = await cameraService.checkFfmpeg();
          reply = `Camera status — ffmpeg: ${ff ? '✓' : '✗ not installed'} | Recording: ${rec.recording ? `Yes (${rec.filename})` : 'No'}`;
          break;

        default:
          reply = 'Camera command not recognized, Boss.';
      }
      return res.json({ content: [{ type: 'text', text: reply }] });
    }

    // ── Browser / YouTube Intent Detection ─────────────────────────────────
    const browserIntent = browserService.parseBrowserIntent(lastMsg);
    if (browserIntent) {
      if (!browserService.isConnected()) {
        return res.json({ content: [{ type: 'text', text: 'Browser extension not connected, Boss. Install the JARVIS Chrome Extension and make sure the server is running.' }] });
      }
      try {
        const result = await browserService.sendCommand(browserIntent.action, browserIntent.data || {});

        // Build human-friendly reply
        let reply = '';
        const a   = browserIntent.action;

        if (a === 'get_page_info') {
          const p = browserService.getPageState();
          reply = `You're on: ${p.title}\n${p.url}`;
        } else if (a === 'navigate') {
          reply = `Navigating to ${browserIntent.data.url}, Boss.`;
        } else if (a === 'go_back')    { reply = 'Going back, Boss.'; }
        else if (a === 'go_forward')   { reply = 'Going forward, Boss.'; }
        else if (a === 'reload')        { reply = 'Page refreshed, Boss.'; }
        else if (a === 'new_tab')       { reply = 'New tab opened, Boss.'; }
        else if (a === 'close_tab')     { reply = 'Tab closed, Boss.'; }
        else if (a === 'scroll_down')   { reply = 'Scrolled down, Boss.'; }
        else if (a === 'scroll_up')     { reply = 'Scrolled up, Boss.'; }
        else if (a === 'scroll_top')    { reply = 'Jumped to top, Boss.'; }
        else if (a === 'scroll_bottom') { reply = 'Jumped to bottom, Boss.'; }
        else if (a === 'zoom_in')       { reply = 'Zoomed in, Boss.'; }
        else if (a === 'zoom_out')      { reply = 'Zoomed out, Boss.'; }
        else if (a === 'zoom_reset')    { reply = 'Zoom reset, Boss.'; }
        else if (a === 'click_text')    { reply = result?.clicked ? `Clicked "${result.clicked}", Boss.` : (result?.error || 'Could not find that element, Boss.'); }
        else if (a === 'type_in')       { reply = `Typed "${browserIntent.data.text}", Boss.`; }
        else if (a === 'yt_play' || a === 'yt_resume') {
          const title = result?.title;
          reply = title ? `Playing "${title}", Boss.` : 'Playing the video, Boss.';
        }
        else if (a === 'yt_play_video') {
          if (result?.resumed) {
            reply = result.title ? `Resumed "${result.title}", Boss.` : 'Resumed the video, Boss.';
          } else {
            reply = `Searching and playing "${browserIntent.data.query}" on YouTube, Boss. Give it 3 seconds...`;
          }
        }
        else if (a === 'yt_pause')      { reply = 'Video paused, Boss.'; }
        else if (a === 'yt_next')       { reply = 'Skipping to next video, Boss.'; }
        else if (a === 'yt_mute')       { reply = 'Video muted, Boss.'; }
        else if (a === 'yt_unmute')     { reply = 'Video unmuted, Boss.'; }
        else if (a === 'yt_fullscreen') { reply = 'Fullscreen toggled, Boss.'; }
        else if (a === 'yt_volume_up')  { reply = `Volume up — now ${result?.volume ?? '?'}%, Boss.`; }
        else if (a === 'yt_volume_down'){ reply = `Volume down — now ${result?.volume ?? '?'}%, Boss.`; }
        else if (a === 'yt_volume')     { reply = `Volume set to ${browserIntent.data.value}%, Boss.`; }
        else if (a === 'yt_seek')       { reply = `Seeked ${browserIntent.data.seconds > 0 ? '+' : ''}${browserIntent.data.seconds}s, Boss.`; }
        else if (a === 'yt_speed')      { reply = `Playback speed set to ${browserIntent.data.rate}x, Boss.`; }
        else if (a === 'yt_like')       { reply = 'Liked the video, Boss.'; }
        else if (a === 'yt_dislike')    { reply = 'Disliked the video, Boss.'; }
        else if (a === 'yt_subscribe')  { reply = 'Subscribe button clicked, Boss.'; }
        else if (a === 'yt_skip_ad')    { reply = 'Ad skipped, Boss.'; }
        else if (a === 'yt_theater')    { reply = 'Theater mode toggled, Boss.'; }
        else if (a === 'yt_miniplayer') { reply = 'Mini player toggled, Boss.'; }
        else if (a === 'yt_captions')   { reply = 'Captions toggled, Boss.'; }
        else if (a === 'yt_save')       { reply = 'Save dialog opened, Boss.'; }
        else if (a === 'yt_autoplay')   { reply = 'Autoplay toggled, Boss.'; }
        else if (a === 'yt_channel')    { reply = 'Opening channel, Boss.'; }
        else if (a === 'yt_info') {
          const r = result || {};
          const mins = r.duration ? Math.floor(r.duration / 60) + ':' + String(Math.floor(r.duration % 60)).padStart(2,'0') : '?';
          reply = `Now playing: ${r.title || '?'}\nTime: ${r.currentTime ? Math.floor(r.currentTime) + 's' : '?'} / ${mins} | Volume: ${r.volume != null ? Math.round(r.volume * 100) + '%' : '?'} | Speed: ${r.speed || 1}x | ${r.paused ? 'Paused' : 'Playing'}`;
        } else if (a === 'yt_search')   { reply = `Searching YouTube for "${browserIntent.data.query}", Boss.`; }
        else { reply = `Done, Boss. ${JSON.stringify(result)}`; }

        return res.json({ content: [{ type: 'text', text: reply }] });
      } catch (err) {
        return res.json({ content: [{ type: 'text', text: `Browser command failed: ${err.message}` }] });
      }
    }

    const { systemPrompt, searchMeta } = await chatService.buildSystemPrompt({
      system, userProfile, language, isBoss, customInstructions, clientTime,
      documentIds, documentStore, compactMessages,
      userId, emotionData
    });

    const groqMessages = [{ role: 'system', content: systemPrompt }, ...compactMessages];

    logger.info(`Chat → User: ${userProfile?.name || 'Anonymous'} | Mode: ${userProfile?.domain || 'General'} | Lang: ${(language || 'en').toUpperCase()}`);

    const hasDocuments = Array.isArray(documentIds) && documentIds.length > 0;

    const response = await aiService.callGroq({
      model:       aiService.GROQ_MODEL,
      messages:    groqMessages,
      max_tokens:  hasDocuments ? 1400 : (max_tokens || 1024),
      temperature: hasDocuments ? 0.3 : 0.7
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('AI API error: ' + errText);
      return res.status(response.status).json({ error: errText });
    }

    const data  = await response.json();
    const reply = data?.choices?.[0]?.message?.content || '';
    logger.info('Chat response sent');

    // ── Persist this turn to Supabase (fire-and-forget) ────────────────────
    // This is how JARVIS "remembers" across sessions and page reloads.
    const sessionId = req.headers['x-session-id'] || null;
    memoryService.saveConversationTurn(userId, 'user',      lastMsg, sessionId).catch(() => {});
    memoryService.saveConversationTurn(userId, 'assistant', reply,   sessionId).catch(() => {});

    // Track chat topic for habit learning (fire-and-forget)
    if (lastMsg.length > 10) {
      habitService.trackAction(userId, habitService.ACTION_TYPES.CHAT_TOPIC, {
        topic: lastMsg.slice(0, 80),
        emotion: emotionData?.emotion || 'neutral'
      }).catch(() => {});
    }

    res.json({ content: [{ type: 'text', text: reply }], searchResults: searchMeta });

  } catch (error) {
    logger.error('Chat error: ' + error.message);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

// ─── GET /api/tts ─────────────────────────────────────────────────────────────

exports.tts = async (req, res) => {
  const text = (req.query.text || '').trim().slice(0, 200);
  const lang = (req.query.lang || 'ta').replace(/[^a-z-]/gi, '');
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=gtx&ttsspeed=0.9`;
  try {
    const ttsResp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    'https://translate.google.com/'
      }
    });
    if (!ttsResp.ok) return res.status(502).json({ error: 'TTS service unavailable' });
    const buf = Buffer.from(await ttsResp.arrayBuffer());
    res.setHeader('Content-Type',   'audio/mpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control',  'no-cache');
    res.send(buf);
    logger.info(`TTS [${lang}]: "${text.slice(0, 40)}..."`);
  } catch (e) {
    logger.error('TTS error: ' + e.message);
    res.status(500).json({ error: 'TTS proxy error' });
  }
};

// ─── POST /api/transcribe ─────────────────────────────────────────────────────

exports.transcribe = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No audio file received' });
  const groqKey = aiService.getGroqKey();
  if (!groqKey) return res.json({ success: false, error: 'No Groq API key configured' });
  const boundary = `JarvisAudioBoundary${Date.now()}`;
  const filename = (req.file.originalname || 'audio.webm').replace(/[^\w.-]/g, '_');
  const mime     = req.file.mimetype || 'audio/webm';
  try {
    const formBuffer = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      req.file.buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body:    formBuffer
    });
    const text = await resp.text();
    if (!resp.ok) return res.json({ success: false, error: text.slice(0, 300) });
    res.json({ success: true, transcript: text.trim() });
  } catch (e) { res.json({ success: false, error: e.message }); }
};

// ─── POST /api/vision ─────────────────────────────────────────────────────────

exports.vision = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No image received' });
  const geminiKey = aiService.getGeminiKey();
  if (!geminiKey) return res.json({ success: false, error: 'No Gemini API key configured. Add GEMINI_API_KEY to .env' });
  const question = String(req.body.question || 'Describe what you see in this image in detail.').slice(0, 1000);
  try {
    const payload = { contents: [{ parts: [{ text: question }, { inlineData: { mimeType: req.file.mimetype || 'image/jpeg', data: req.file.buffer.toString('base64') } }] }] };
    const resp    = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    const data   = await resp.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from vision model.';
    res.json({ success: true, answer });
  } catch (e) { res.json({ success: false, error: e.message }); }
};

// ─── POST /api/image-gen ──────────────────────────────────────────────────────

exports.imageGen = (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });
  const safe = encodeURIComponent(String(prompt).slice(0, 500));
  res.json({ success: true, imageUrl: `https://image.pollinations.ai/prompt/${safe}?width=512&height=512&nologo=true` });
};
