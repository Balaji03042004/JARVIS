# JARVIS — Complete Codebase Documentation
### Every file. Every function. Every line explained.

---

## Table of Contents

1. [server.js — The Backend Brain](#1-serverjs--the-backend-brain)
2. [config.js — Constants and Prompts](#2-configjs--constants-and-prompts)
3. [state.js — Global Application State](#3-statejs--global-application-state)
4. [app.js — Application Initializer](#4-appjs--application-initializer)
5. [ui.js — UI Helpers and Language](#5-uijs--ui-helpers-and-language)
6. [chat.js — Message Rendering and Sending](#6-chatjs--message-rendering-and-sending)
7. [tts.js — Text-to-Speech Engine](#7-ttsjs--text-to-speech-engine)
8. [speech.js — Voice Recognition and Noise Pipeline](#8-speechjs--voice-recognition-and-noise-pipeline)
9. [profile.js — User Profile System](#9-profilejs--user-profile-system)
10. [verify.js — Identity Verification (Boss Gate)](#10-verifyjs--identity-verification-boss-gate)
11. [voice.js — Voice Selector and Voice Commands](#11-voicejs--voice-selector-and-voice-commands)
12. [system.js — Local System Command Handler](#12-systemjs--local-system-command-handler)
13. [filesystem.js — File and Drive Browser](#13-filesystemjs--file-and-drive-browser)
14. [music-player.js — YouTube Embedded Player](#14-music-playerjs--youtube-embedded-player)
15. [conversations.js — Chat History](#15-conversationsjs--chat-history)
16. [features.js — Feature Development System](#16-featuresjs--feature-development-system)
17. [sentiment.js — Sentiment, Intent, Entities](#17-sentimentjs--sentiment-intent-entities)
18. [CSS Files — Styling System](#18-css-files--styling-system)
19. [index.html — The UI Shell](#19-indexhtml--the-ui-shell)
20. [.env — Environment Variables](#20-env--environment-variables)
21. [How All Files Connect Together](#21-how-all-files-connect-together)

---

## 1. server.js — The Backend Brain

**What it is:** The Node.js server that runs on your PC at `http://localhost:3000`. It is the middleman between the browser (frontend) and everything else — AI APIs, your file system, Spotify, and system commands.

**Why it exists:** The browser cannot directly read files from your hard drive, run PowerShell commands, or make API calls to Groq (due to CORS restrictions). The server solves all of this.

---

### Lines 1–18 — Setup and Imports

```javascript
require('dotenv').config();
```
**Why:** Loads all the variables from the `.env` file (API keys) into `process.env`. Without this, `process.env.GROQ_API_KEY` would be `undefined`.

```javascript
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
```
**Why:** Disables SSL certificate validation. Some API endpoints have certificate issues in Node.js. This prevents `CERT_HAS_EXPIRED` errors. Only safe because JARVIS runs locally.

```javascript
const { fetch: undicicFetch } = require('undici');
```
**Why:** `undici` is a high-performance HTTP library. Used specifically for scraping YouTube search results because it handles redirects and large HTML responses more reliably than standard `fetch`.

```javascript
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
```
**Why each:**
- `express` — creates the web server and handles routes (URL endpoints)
- `cors` — allows the browser to call `localhost:3000` without being blocked
- `path` — safely joins file paths (works on Windows and Linux)
- `fs` — reads/writes files and lists directories on your PC
- `os` — gets RAM, hostname, OS type, home folder
- `exec` / `spawn` — runs shell commands (PowerShell, CMD)
- `promisify(exec)` — converts the callback-based `exec` into a Promise so we can use `await`

---

### Lines 20–130 — AI Provider Configuration and Rotation

```javascript
const _groqKeys = [ process.env.GROQ_API_KEY, ... ].filter(Boolean);
```
**Why:** Reads up to 8 Groq keys from `.env`. `filter(Boolean)` removes any `undefined` entries (keys not set). This creates an array of only the keys you actually have.

```javascript
let _groqKeyIdx = 0;
```
**Why:** Tracks which key to use next. When one key gets rate-limited (429 error), this index increments so the next key is used automatically.

```javascript
async function _callProvider(keys, keyIdxRef, url, modelOverride, body, providerName)
```
**Why this exists:** DRY principle — Groq, Gemini, and OpenRouter all work the same way (POST request with Bearer token). Instead of writing three separate functions, one generic function handles all three. `keyIdxRef` is an object `{val: 0}` so the index can be modified inside the function and the change is visible outside (JavaScript objects are passed by reference).

```javascript
if (resp.status === 429 || resp.status === 503)
```
**Why:** 429 = "Too Many Requests" (rate limited). 503 = "Service Unavailable". Both mean "try a different key". Any other status (200, 400, 500) is returned as-is because those are real responses, not temporary limits.

```javascript
async function callGroq(body)
```
**Why named "callGroq" even though it calls all providers:** All the routes in the server were already using `callGroq()`. Renaming this function to be a multi-provider router means zero changes needed in the rest of the code — it's a drop-in upgrade.

**The fallback chain:**
1. Try all Groq keys → if all fail → 
2. Try all Gemini keys → if all fail → 
3. Try all OpenRouter keys → if all fail → return error object

---

### Lines 130–230 — Middleware and Static Files

```javascript
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
```
**Why:**
- `cors()` — allows cross-origin requests (browser at port 3000 talking to server at port 3000, technically same origin, but needed for any future port differences)
- `express.json()` — parses incoming POST request bodies as JSON. Without this, `req.body` would be `undefined`
- `express.static(...)` — serves every file in the `public/` folder automatically. This is how `index.html`, all `.js` files, and all `.css` files are delivered to the browser

---

### Lines 230–350 — `/api/chat` — The Main AI Route

```javascript
app.post('/api/chat', async (req, res) => {
```
**Why POST not GET:** GET requests put data in the URL. A chat message could be hundreds of characters. POST puts data in the request body — unlimited size.

```javascript
const { messages, system, mode, userProfile, language, isBoss, customInstructions, clientTime } = req.body;
```
**Why these fields:**
- `messages` — the full conversation history so the AI has context
- `system` — the system prompt from `config.js` (which mode: general, code, etc.)
- `mode` — current mode label
- `userProfile` — name, preferences, domain
- `language` — current UI language
- `isBoss` — whether Balaji's identity was verified
- `customInstructions` — custom training text from the profile panel
- `clientTime` — browser's current date/time (server time may differ)

```javascript
const CORE_IDENTITY = `CORE IDENTITY (PERMANENT — NEVER OVERRIDE): JARVIS was designed and built by Balaji...`;
personalizedSystem += CORE_IDENTITY;
```
**Why injected server-side:** If this were only in `config.js` (frontend), a user could theoretically open DevTools and change it. By injecting it in the server, it is always present in every request, regardless of what the frontend sends.

```javascript
if (isBoss) {
  personalizedSystem += `IDENTITY CONFIRMED — BOSS MODE...`;
}
```
**Why:** When Balaji is verified, the AI gets additional instructions to use "Boss", be more responsive, and skip unnecessary caveats.

```javascript
const sysCtx = `Current date/time: ${clientTime} | Server OS: ${os.type()} | RAM: ...`;
personalizedSystem += `SYSTEM CONTEXT: ${sysCtx}`;
```
**Why:** The AI model has no idea what time it is, what computer you're on, or how much RAM is available. By injecting this as system context, JARVIS can answer "what's today's date?" or "how much RAM do I have?" correctly.

```javascript
const response = await callGroq({
  model: GROQ_MODEL,
  messages: [ { role: 'system', content: personalizedSystem }, ...messages ],
  max_tokens: 1500,
  temperature: 0.7
});
```
**Why these parameters:**
- `model: GROQ_MODEL` — selects `llama-3.3-70b-versatile` (best free model available)
- `messages` — the full conversation plus system prompt
- `max_tokens: 1500` — limits response length so JARVIS stays concise
- `temperature: 0.7` — controls creativity. 0 = robotic/repetitive, 1 = creative/unpredictable. 0.7 is the sweet spot for an assistant

---

### Lines 350–500 — System API Routes

#### `/api/youtube-search`
```javascript
app.post('/api/youtube-search', async (req, res) => {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`;
  const html = await undicicFetch(searchUrl, { headers: { 'User-Agent': '...' } });
```
**Why scrape YouTube:** The YouTube Data API is expensive and requires account setup. Scraping the search results page is free. `EgIQAQ%3D%3D` is a base64 filter that restricts results to videos only (no playlists/channels).

**Why `undici` instead of `fetch`:** YouTube returns large HTML pages. `undici` handles these more reliably without timeout issues.

```javascript
const videoIds = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]);
```
**Why:** YouTube embeds video IDs as JSON in the page HTML. A regex finds all 11-character video IDs. The `[...matchAll()]` converts the iterator to an array.

#### `/api/spotify`
```javascript
app.post('/api/spotify', async (req, res) => {
  if (action === 'search-play') {
    const escapedQuery = query.replace(/'/g, "''");
    const ps1 = `Start-Process "spotify:search:${escapedQuery}"`;
    const tmpFile = path.join(os.tmpdir(), `jarvis_spot_${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, ps1);
    exec(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`...);
```
**Why write to a temp `.ps1` file instead of inline PowerShell:** Inline PowerShell strings have escaping problems with song titles containing apostrophes, quotes, or special characters. Writing to a file avoids all escaping issues — the file contains the exact text.

**Why `spotify:` URI:** Spotify Desktop App registers `spotify:` as a custom URI protocol. Opening `spotify:search:query` triggers the app directly, like how `mailto:` opens your email client.

**The auto-play mechanism:**
```javascript
const autoPlayScript = `
  Add-Type -AssemblyName Microsoft.VisualBasic
  $spotify = Get-Process spotify -ErrorAction SilentlyContinue
  if ($spotify) {
    [Microsoft.VisualBasic.Interaction]::AppActivate($spotify.Id)
    Start-Sleep -Milliseconds 800
    [System.Windows.Forms.SendKeys]::SendWait("{DOWN}{ENTER}")
  }
`;
```
**Why:** Spotify's Desktop App doesn't have a local control API. The only way to auto-select the first result is to simulate keyboard input. `AppActivate` brings Spotify to the foreground. `SendKeys` simulates pressing Down arrow (selects first result) and Enter (plays it).

#### `/api/filesystem`
```javascript
app.post('/api/filesystem', async (req, res) => {
  if (action === 'list') {
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
```
**Why `withFileTypes: true`:** Returns `Dirent` objects which have `.isDirectory()` and `.isFile()` methods. Without this, you'd need a second call to `fs.statSync()` for each entry to know if it's a file or folder.

```javascript
const stats = fs.statSync(fullPath);
return {
  name: entry.name,
  type: entry.isDirectory() ? 'folder' : 'file',
  size: stats.size,
  sizeFmt: formatFileSize(stats.size),
  modified: stats.mtime.toLocaleString(),
  ...
};
```
**Why collect all this:** The frontend displays file size, date, and type. Collecting everything in one server call is faster than multiple requests.

#### `/api/system-info`
```javascript
const ram  = os.totalmem();
const free = os.freemem();
const cpus = os.cpus();
```
**Why `os` module:** The browser has no access to system hardware. Node.js `os` module reads directly from the OS kernel — no external API needed.

#### `/api/tts`
```javascript
app.get('/api/tts', async (req, res) => {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
  const audio = await fetch(url, { headers: { 'User-Agent': '...' } });
```
**Why Google Translate TTS:** For non-English languages, the browser's built-in voices are often poor quality. Google Translate has excellent multi-language TTS. This route proxies the audio so the browser doesn't hit CORS restrictions calling Google directly.

**Why only for non-English:** English uses the browser's built-in `SpeechSynthesis` API which is higher quality and has no network delay.

---

## 2. config.js — Constants and Prompts

**What it is:** A pure constants file. No functions, no state, just values.

**Why separated:** Having all prompts and labels in one place makes them easy to update without digging through logic code.

### SYSTEM_PROMPTS
```javascript
const SYSTEM_PROMPTS = {
  general: `You are JARVIS — an advanced AI assistant designed and built by Balaji...`,
  code:    `You are JARVIS Code Engine — built by Balaji...`,
  ibps:    `You are JARVIS iBPS Specialist...`,
  debug:   `You are JARVIS Debug Engine...`,
  sql:     `You are JARVIS SQL Optimizer...`
};
```
**Why multiple prompts:** Each mode needs a different "personality" and set of instructions. The Code Engine should always use code blocks. The Debug Engine should always follow the 5-step analysis format. The iBPS specialist knows Newgen-specific APIs. A single general prompt would make all modes generic.

### LANG_MAP_TTS
```javascript
const LANG_MAP_TTS = { en: 'en-US', ta: 'ta-IN', hi: 'hi-IN', ... };
```
**Why:** The Web Speech API uses BCP-47 language tags (`en-US`, `ta-IN`). JARVIS uses short codes (`en`, `ta`). This map converts between them. Without it, you'd hardcode language tags in every file that uses speech.

---

## 3. state.js — Global Application State

**What it is:** All the variables that change during the app's lifetime. Every other JS file reads from and writes to these variables.

**Why a separate file:** JavaScript in browsers shares a global scope for all script files. By keeping all state in one file loaded first, every other file can access these variables. This is a simple "global store" pattern.

```javascript
let currentMode = 'general';
```
Which AI mode is active (general / code / ibps / debug / sql).

```javascript
let isVerifiedBoss = false;
```
Set to `true` only after the identity verification overlay confirms the user typed "Balaji". Controls whether boss-mode prompts are sent and whether boss-only voice commands work.

```javascript
let conversationMode = false;
```
Hands-free mode. When `true`, JARVIS automatically starts listening again after every response, creating a continuous voice conversation.

```javascript
let selectedVoiceURI = localStorage.getItem('jarvisVoiceURI') || null;
```
**Why read from localStorage immediately:** Voice preference should persist across page refreshes. Reading it at module load time means the voice is applied before the first thing JARVIS says.

```javascript
let _cachedVoices = [];
function getCachedVoices() {
  if (_cachedVoices.length === 0) _cachedVoices = window.speechSynthesis.getVoices();
  return _cachedVoices;
}
window.speechSynthesis.onvoiceschanged = () => { _cachedVoices = window.speechSynthesis.getVoices(); };
```
**Why cache voices:** `window.speechSynthesis.getVoices()` is an async operation and sometimes returns an empty array on first call. Chrome fires `onvoiceschanged` when the list is ready. The cache ensures we always have a valid list after the event fires.

---

## 4. app.js — Application Initializer

**What it is:** The entry point that runs when the page fully loads.

```javascript
window.addEventListener('load', () => {
  loadProfile();
  loadLanguage();
  loadConversationHistory();
  loadFeatureData();
  updateContextBar();
  setTimeout(() => { _cachedVoices = window.speechSynthesis?.getVoices() || []; }, 600);
  if (typeof initVerification === 'function') initVerification();
});
```
**Why `window.load` not `DOMContentLoaded`:** `DOMContentLoaded` fires before images and external scripts finish loading. `load` fires after everything is ready — important because we need YouTube IFrame API and all JS files available before initializing.

**Why `setTimeout(..., 600)` for voices:** Chrome's voice list loads asynchronously. 600ms gives the browser time to populate it. Without this delay, `getVoices()` often returns empty.

```javascript
setInterval(autoSaveConversation, 300_000);
```
**Why:** Auto-saves every 5 minutes (300,000ms). Prevents losing a long conversation if the browser crashes or the tab is closed accidentally.

```javascript
window.addEventListener('beforeunload', () => {
  if (conversationHistory.length > 0)
    saveConversation(`Auto-saved before close ${new Date().toLocaleTimeString()}`);
});
```
**Why:** `beforeunload` fires just before the tab closes. This is the last opportunity to save. Without this, closing the tab without manually saving loses the conversation.

---

## 5. ui.js — UI Helpers and Language

**What it is:** Utility functions that update the visible UI.

```javascript
function setStatus(txt, isErr = false) {
  document.getElementById('statusLabel').textContent = txt;
  dot.style.background = isErr ? 'var(--red)' : 'var(--green)';
}
```
**Why `isErr` changes dot color:** The status dot in the header turns red during operations (searching, listening) and green when idle. This gives a quick visual signal without reading the text.

```javascript
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
```
**Why set to `auto` first:** Setting height to `auto` collapses the textarea to its natural height, then `scrollHeight` measures the true content height. Without the reset to `auto`, the textarea would only ever grow, never shrink when text is deleted.

**Why cap at 140px:** The input area shouldn't take over the entire screen. 140px is about 4-5 lines of text — enough for most messages.

```javascript
function setLanguage(lang) {
  currentLanguage = lang;
  localStorage.setItem('jarvisLanguage', lang);
  recognition = null; // reset speech engine for new lang
```
**Why `recognition = null`:** The Web Speech API `SpeechRecognition` object is tied to a specific language at creation time. You can't change the language of an existing instance. Setting it to `null` forces `initSpeech()` to create a fresh instance with the new language next time the mic is activated.

---

## 6. chat.js — Message Rendering and Sending

**What it is:** Handles displaying messages and the core `sendMessage()` function.

### parseContent(text)
```javascript
function parseContent(text) {
  let html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
```
**Why sanitize first:** The AI's response could contain `<` and `>` characters (e.g., in HTML examples or math). If inserted directly as `innerHTML`, these would be interpreted as HTML tags and could break the layout or create XSS vulnerabilities. Replacing them with HTML entities makes them display as literal characters.

```javascript
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const id = 'c_' + Math.random().toString(36).substr(2,6);
    return `<div class="code-header">...<button onclick="copyCode('${id}')">COPY</button>...
            <pre id="${id}">${code.trim()}</pre>`;
  });
```
**Why random ID:** Each code block needs a unique DOM id so the `copyCode()` function knows which `<pre>` element to copy. Using `Math.random()` generates a unique 6-character ID like `c_a3f8k2`.

### addMessage(role, text)
```javascript
function addMessage(role, text) {
  _removeWelcome();
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `
    <div class="avatar ${role}">${isAI ? '⬡' : '▶'}</div>
    <div class="bubble ${role}">${isAI ? parseContent(text) : text.replace(...)}</div>`;
  msgs.appendChild(div);
  scrollToBottom();
  if (isAI) speak(text);
```
**Why `speak(text)` called here:** Every time JARVIS adds a message to the chat, it is also spoken aloud automatically. This is what makes JARVIS a voice assistant — no separate "read this" button needed.

**Why user text is NOT `parseContent`-processed:** User input is displayed as plain text (only escaping `<` and `>`). Markdown formatting is only for JARVIS's responses, not user messages.

### sendMessage()
```javascript
async function sendMessage() {
  const text = document.getElementById('userInput').value.trim();
  
  // 1. Check voice commands first
  if (typeof handleVoiceCommand === 'function' && handleVoiceCommand(text)) return;
  
  // 2. Check local system commands
  if (typeof handleSystemCommand === 'function') {
    const handled = await handleSystemCommand(text);
    if (handled) return;
  }
  
  // 3. Send to AI
  const response = await fetch('/api/chat', { ... });
```
**Why the three-layer check:**
1. Voice commands ("change to female voice") are handled 100% locally
2. System commands ("open Notepad", "play music") are handled by the Node.js server — no AI needed
3. Everything else goes to the AI

This architecture means JARVIS responds **instantly** to system commands because they never hit an external API.

---

## 7. tts.js — Text-to-Speech Engine

**What it is:** Makes JARVIS speak. Two paths — English (browser) and other languages (Google Translate proxy).

```javascript
let _ttsSynthKeepalive = null;
```
**Why this variable:** Chrome has a bug where `speechSynthesis.speak()` silently stops after ~15 seconds. `_ttsSynthKeepalive` stores an interval timer that calls `pause()` + `resume()` every 10 seconds to prevent Chrome from stopping mid-sentence.

```javascript
const cleanText = text
  .replace(/\*\*(.*?)\*\*/g, '$1')
  .replace(/```[\s\S]*?```/g, 'code block')
  .replace(/`([^`]+)`/g, '$1')
```
**Why clean before speaking:** The AI's response contains markdown formatting (`**bold**`, ` ```code``` `). These should not be spoken aloud — saying "asterisk asterisk open asterisk asterisk close" is not useful. This strips markdown to plain readable text.

**Why replace code blocks with "code block":** Reading out a 50-line code snippet would take minutes. "Code block" as a replacement tells the user a code block exists without reading it.

```javascript
utterance.rate   = 0.88;
utterance.pitch  = 1.0;
utterance.volume = 1.0;
```
**Why rate 0.88:** Slightly slower than default (1.0). AI-generated text can be dense. 0.88 makes it easier to follow without being annoyingly slow.

```javascript
clearInterval(_ttsSynthKeepalive);
_ttsSynthKeepalive = setInterval(() => {
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
    window.speechSynthesis.resume();
  }
}, 10000);
```
**Why pause then immediately resume:** This is a documented Chrome workaround. The `pause()`+`resume()` cycle resets Chrome's internal timer that would otherwise kill the utterance at 15 seconds. The speech continues without any audible gap.

---

## 8. speech.js — Voice Recognition and Noise Pipeline

**What it is:** Everything related to the microphone — capturing voice, noise filtering, and the hands-free interrupt system.

### Audio Pipeline

```javascript
async function _initAudioPipeline() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl:  true,
      channelCount:     1
    }
  });
  _audioCtx = new AudioContext();
  const src = _audioCtx.createMediaStreamSource(stream);
  _analyser = _audioCtx.createAnalyser();
  _analyser.fftSize = 512;
  src.connect(_analyser);
```
**Why `getUserMedia` with these constraints:**
- `echoCancellation` — prevents JARVIS's speaker output from being picked up by the mic and sent back (feedback loop)
- `noiseSuppression` — browser applies DSP filtering to reduce fan noise, AC hum, keyboard clicks
- `autoGainControl` — normalizes microphone volume so you don't need to speak loudly
- `channelCount: 1` — mono audio. Stereo would waste bandwidth and processing for speech recognition
- `fftSize: 512` — Fast Fourier Transform size. 512 samples gives good frequency resolution for measuring audio level

```javascript
function _getAudioLevel() {
  const buf = new Uint8Array(_analyser.fftSize);
  _analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;  // normalize: 0-255 → -1 to +1
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);  // RMS (Root Mean Square)
}
```
**Why RMS:** RMS (Root Mean Square) is the standard way to measure audio loudness. It's the square root of the average of squared values. Simple peak amplitude would fluctuate too much. RMS gives a stable "loudness" reading.

**Why `buf[i] - 128`:** `getByteTimeDomainData` returns 8-bit values (0-255) where 128 = silence. Subtracting 128 centers them around 0, then dividing by 128 normalizes to -1 to +1.

### Interrupt Listener

```javascript
function startInterruptListener() {
  if (!conversationMode || _interruptRecog || isListening) return;
  const r = _buildRecog(true);
  _interruptRecog = r;
  r.start();
}
```
**Why a second recognition instance:** The main `recognition` object is used for regular listening. A separate `_interruptRecog` instance runs **during TTS** so Balaji can speak at any time and cut JARVIS off mid-sentence. Without this, JARVIS would have to finish speaking before listening again.

```javascript
r.onspeechstart = () => {
  if (Date.now() - _ttsStartedAt < 1500) return;  // echo guard
  if (isCurrentlySpeaking) stopSpeaking();
```
**Why the 1500ms echo guard:** When JARVIS starts speaking, the microphone can pick up the speaker output. If `onspeechstart` fired immediately, it would detect JARVIS's own voice and kill the TTS instantly. Waiting 1500ms ensures the guard only fires when Balaji's voice is detected, not the TTS onset.

```javascript
if (isCurrentlySpeaking && conversationMode) {
  _ttsStartedAt = Date.now();  // refresh echo guard for new instance
  setTimeout(startInterruptListener, 600);
}
```
**Why reset `_ttsStartedAt`:** The interrupt listener restarts every time it times out (after detecting no speech for a few seconds). Each new instance needs a fresh echo guard window. Without this reset, the guard would expire early in a long TTS response, allowing the speaker's own voice to be misidentified as a user command.

---

## 9. profile.js — User Profile System

**What it is:** Manages the user's name, preferences, language, custom instructions, and voice settings.

```javascript
function loadProfile() {
  const saved = localStorage.getItem('jarvisUserProfile');
  if (saved) { try { userProfile = JSON.parse(saved); } catch(e) {} }
  if (!userProfile.name || userProfile.name === 'User') {
    userProfile.name = 'Balaji';
    localStorage.setItem('jarvisUserProfile', JSON.stringify(userProfile));
  }
  updateProfileUI();
}
```
**Why `try/catch` around `JSON.parse`:** If `localStorage` contains corrupted JSON (e.g., browser crash during save), `JSON.parse` throws an error. The `try/catch` prevents this from crashing the entire app — it just uses the default profile instead.

**Why default name to "Balaji":** If no profile has been set up, the name defaults to "Balaji" so Boss mode works from the first launch without any manual configuration.

```javascript
const noiseSlider = document.getElementById('noiseThreshSlider');
const savedNoise  = localStorage.getItem('jarvisNoiseThreshold') || '0.018';
if (noiseSlider) noiseSlider.value = savedNoise;
```
**Why stored separately from userProfile:** The noise threshold is a hardware/environment setting, not a user identity setting. Keeping it in its own `localStorage` key means it survives profile resets.

---

## 10. verify.js — Identity Verification (Boss Gate)

**What it is:** The startup overlay that asks for name. Grants boss mode if name matches profile.

```javascript
function initVerification() {
  setTimeout(() => {
    overlay.classList.add('visible');
    setTimeout(() => {
      speak('Identity verification required. Please state your name.');
    }, 700);
  }, 500);
}
```
**Why two nested timeouts:** First 500ms — lets the page fully render before showing the overlay (prevents visual flicker). Second 700ms inside the overlay — waits for the fade-in animation to complete before JARVIS speaks, so the voice doesn't start before the overlay is visible.

```javascript
if (val.toLowerCase() === registeredName.toLowerCase()) {
  isVerifiedBoss = true;
```
**Why `toLowerCase()` on both sides:** Case-insensitive comparison. "balaji", "Balaji", and "BALAJI" all verify correctly. The user shouldn't have to type the exact case.

```javascript
box.classList.add('denied');
setTimeout(() => box.classList.remove('denied'), 800);
```
**Why add then remove:** The `denied` CSS class triggers a shake animation (defined in `animations.css`). Removing it after 800ms resets the element so the animation can play again if the user types wrong again. Without removal, the animation would only play once.

---

## 11. voice.js — Voice Selector and Voice Commands

**What it is:** Handles natural language voice change requests ("switch to female voice") and populates the voice dropdown in the profile panel.

```javascript
const isVoiceIntent =
  /(change|switch|use|set|make|turn|pick|select|try|give me|want).{0,25}(voice|sound|speak|tone)/i.test(t);
```
**Why regex with `.{0,25}`:** The `{0,25}` means "between 0 and 25 characters between the verb and noun". This catches phrases like "change my JARVIS speaking voice" where there are words between "change" and "voice". Without the flexible middle, "change my voice" would match but "change the sound that JARVIS uses" would not.

**Why this check runs BEFORE the AI call:** Voice changes are instant and local — no API call needed. Checking first prevents sending "change to female voice" to Groq, which would waste an API call and give a text reply instead of actually changing the voice.

```javascript
const nameMatch = t.match(/(?:use|switch to|change to|try)\s+([a-z]+(?:\s+[a-z]+)?)\s*(?:voice)?$/i);
```
**Why match specific voice names:** If you say "use Samantha voice", JARVIS finds a browser voice whose name contains "Samantha". This allows using any voice available in your browser/OS by name.

---

## 12. system.js — Local System Command Handler

**What it is:** The largest frontend file. Detects and handles all local system commands — music, apps, browsing, running commands, GPS, system info.

### handleSystemCommand() — The Master Dispatcher

```javascript
async function handleSystemCommand(text) {
  if (detectSysInfoIntent(text))    return await handleSysInfo(text);
  if (detectAppListIntent(text))    return await handleAppList(text);
  if (detectLocationIntent(text))   return await handleLocationCommand(text);
  if (detectMusicIntent(text))      return await handleMusicCommand(text);
  if (detectBrowseIntent(text))     return await handleBrowse(text);
  if (detectOpenAppIntent(text))    return await handleOpenApp(text);
  if (detectRunCommandIntent(text)) return await handleRunCommand(text);
  return false;
}
```
**Why each check in this order:**
1. System info and app list are very specific — low chance of false positives
2. Location must come before browse (otherwise "where am I?" might trigger a web search)
3. Music before browse (otherwise "play song on YouTube" triggers "open YouTube" instead of the embedded player)
4. Browse before open app (general web actions before specific app launches)
5. Run command last — most permissive, catches "run X" patterns

**Returning `false`** means "I didn't handle this, send it to the AI."

### Platform Detection for Music

```javascript
const _PLATFORM_RE = new RegExp(`\\b(?:on|in|via|through|at|from)\\s+(${_PLATFORM_LIST})\\b`, 'i');
```
**Why `on|in|via|through|at|from`:** Users say "play on Spotify", "play in Spotify", "play via Spotify" — all mean the same thing. This catches all prepositions so the platform is always detected correctly.

### GPS Location Handler

```javascript
async function handleLocationCommand(text) {
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
        );
```
**Why wrap in `new Promise`:** `getCurrentPosition` uses callbacks (old-style async). `await` doesn't work with callbacks. Wrapping in `Promise` lets us use `await` in the calling code.

**Why OpenStreetMap Nominatim for reverse geocoding:** It is 100% free, requires no API key, and converts GPS coordinates to human-readable addresses (city, state, country). Google Maps reverse geocoding requires payment.

---

## 13. filesystem.js — File and Drive Browser

**What it is:** Detects and handles questions about your files and folders.

```javascript
function detectFilesystemIntent(text) {
  const t = text.toLowerCase();
  if (/[a-z]:[\\\/]/i.test(text)) return true;  // explicit path like D:\
  if (/\b[a-z]\s*(drive|:)\b/i.test(t)) return true;  // "D drive"
```
**Why check for explicit paths first:** `D:\Projects\work` is unambiguously a file path. Checking this first avoids running through the longer regex patterns unnecessarily.

```javascript
async function resolveFsPath(text) {
  // Try last accessed path as subfolder context
  if (_lastFsPath) {
    const candidate = _lastFsPath + '\\' + sub;
    const r = await fetch('/api/filesystem', { body: JSON.stringify({ action: 'info', path: candidate }) });
    if (d.success && d.info?.type === 'folder') return candidate;
  }
```
**Why check `_lastFsPath` first:** Context-aware navigation. If you listed `D:\Projects` and then say "go into the web folder", JARVIS checks if `D:\Projects\web` exists before trying to resolve "web" as a generic folder name. This makes browsing feel natural and conversational.

---

## 14. music-player.js — YouTube Embedded Player

**What it is:** Wraps the YouTube IFrame API to create an embedded video player inside JARVIS's UI.

```javascript
function _ytLoadAPI() {
  if (window.YT) { _ytApiReady = true; return; }
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}
```
**Why inject the script dynamically:** The YouTube IFrame API script is large. Loading it only when needed (first music request) keeps initial page load fast.

**Why check `window.YT` first:** If the API was already loaded (e.g., from a previous request), don't load it again. Duplicate script loading causes errors.

```javascript
function playYouTube(videoIds, titles, query) {
  _ytPlaylist = videoIds;
  _ytTitles   = titles;
  _ytPlIdx    = 0;
  if (_ytApiReady && _ytPlayer) {
    _ytPlayer.loadVideoById(_ytPlaylist[0]);
  } else if (_ytApiReady) {
    _ytCreatePlayer(_ytPlaylist[0], _ytTitles[0]);
  } else {
    _ytPendingPlay = { videoIds, titles };
  }
```
**Why `_ytPendingPlay`:** The YouTube API loads asynchronously. If the user requests music before the API finishes loading, the request is stored in `_ytPendingPlay` and played automatically in `onYouTubeIframeAPIReady()`. Without this, the first music request after page load would silently fail.

```javascript
function musicPlayerCmd(cmd) {
  switch (cmd) {
    case 'toggle':
    case 'pause':  _ytPlayer.pauseVideo(); break;
    case 'play':
    case 'resume': _ytPlayer.playVideo(); break;
    case 'next':   _playYTIndex(_ytPlIdx + 1); break;
```
**Why a `toggle` case that does `pauseVideo()`:** The command "pause" might come from voice ("pause") but also from the interrupt listener. Having both `toggle` and `pause` map to the same action prevents double-pausing.

---

## 15. conversations.js — Chat History

**What it is:** Save, load, and display past conversations.

```javascript
function saveConversation(label) {
  const conversation = {
    id:        Date.now(),
    label:     label || `Chat ${new Date().toLocaleDateString()}`,
    messages:  [...conversationHistory],  // ← copy with spread
    timestamp: Date.now()
  };
  allConversations.unshift(conversation);  // add to front
  if (allConversations.length > 50) allConversations.splice(50);  // cap at 50
  localStorage.setItem('jarvisConversations', JSON.stringify(allConversations));
}
```
**Why `[...conversationHistory]` (spread operator):** Creates a shallow copy. If we stored the reference directly, future changes to `conversationHistory` would also change the saved conversation. The copy captures the state at the moment of saving.

**Why `unshift` (add to front):** Most recent conversations should appear at the top of the list, not the bottom.

**Why cap at 50:** `localStorage` has a ~5MB limit per origin. Unlimited conversations would eventually hit this limit and start throwing errors.

---

## 16. features.js — Feature Development System

**What it is:** Lets you request JARVIS to build new features for itself. Sends the request to `/api/develop-feature` which uses the AI to generate implementation code.

```javascript
async function loadCodebaseContext() {
  const files = ['config.js', 'state.js', 'system.js', 'chat.js'];
  const contents = await Promise.all(files.map(f => fetch(`/js/${f}`).then(r => r.text())));
```
**Why send codebase context:** For JARVIS to write code that integrates with itself, the AI needs to know how the existing code is structured. By sending key files, the AI can generate code that uses the right variable names and function signatures.

**Why `Promise.all`:** Fetches all four files simultaneously in parallel instead of one by one. Much faster.

---

## 17. sentiment.js — Sentiment, Intent, Entities

**What it is:** Analyzes user messages to detect mood, intent, and technical entities.

```javascript
function analyzeSentiment(text) {
  const pos = /(happy|great|excellent|awesome|good|love|thank|helpful)/gi;
  const neg = /(bad|hate|terrible|awful|horrible|disappointed)/gi;
  let score = 0;
  if (pos.test(text)) score += 1;
  if (neg.test(text)) score -= 1;
```
**Why keyword-based not ML-based:** A full ML sentiment model would require loading a large model file (hundreds of MB) into the browser. Keyword matching runs instantly, uses zero memory overhead, and is accurate enough for the profile stats feature.

```javascript
function extractEntities(text) {
  const patterns = {
    language:  /\b(Java|JavaScript|Python|SQL|XML|JSON)\b/gi,
    framework: /\b(Spring|React|Vue|Angular|Express)\b/gi,
    platform:  /\b(Newgen|iBPS|AWS|Azure|Docker)\b/gi,
    database:  /\b(Oracle|MySQL|PostgreSQL|MongoDB)\b/gi
  };
```
**Why `\b` word boundaries:** `\bJava\b` matches "Java" but not "JavaScript". Without word boundaries, "JavaScript" would match as containing "Java" which is wrong.

**Why `gi` flags:** `g` = global (find all matches, not just first). `i` = case-insensitive ("java" and "JAVA" and "Java" all match).

---

## 18. CSS Files — Styling System

**Why split into 6 files instead of one:**
Each concern is isolated. If you want to change button styles, you know to look in `components.css` — not a 2000-line monolith.

### variables.css
```css
:root {
  --primary:  #00d4ff;
  --bg:       #0a0f1e;
  --green:    #00ff88;
  --red:      #ff4444;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;
}
```
**Why CSS custom properties (variables):** Change `--primary` once and every button, border, and glow updates everywhere. The JARVIS blue theme is controlled from a single line.

**Why dark theme (`#0a0f1e`):** Pure black is too harsh. `#0a0f1e` is a very dark navy — easier on the eyes for long sessions.

### animations.css
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
.fs-scan-spin { animation: spin 1s linear infinite; }
```
**Why CSS animations not JavaScript:** CSS animations run on the GPU compositor thread — they never block the main JavaScript thread. JavaScript animations (using `setInterval`) can stutter when the main thread is busy processing API responses.

---

## 19. index.html — The UI Shell

**What it is:** A single HTML file that contains the entire UI structure. No separate page for settings, history, or music — everything is in one page, shown/hidden with CSS classes.

**Script load order (important):**
```html
<script src="js/music-player.js?v=1"></script>  ← first (YouTube API callback)
<script src="js/config.js?v=4"></script>         ← constants (needed by everything)
<script src="js/state.js?v=3"></script>           ← variables (needed by everything)
<script src="js/tts.js?v=5"></script>             ← speak() needed by verify.js
<script src="js/speech.js?v=6"></script>          ← needs tts.js functions
<script src="js/ui.js?v=3"></script>              ← needs state.js
<script src="js/profile.js?v=5"></script>         ← needs ui.js, state.js
...
<script src="js/app.js?v=3"></script>             ← last: initializes everything
```
**Why this order:** JavaScript files share a global scope. A file can only use functions/variables from files loaded before it. `config.js` and `state.js` must be first because everything depends on them. `app.js` must be last because it calls functions from all other files.

**Why `?v=4` version numbers:** When you update a JS file, the browser's cache might serve the old version. Adding a version number to the URL forces the browser to fetch the new file. Every time a file is modified, its version is bumped.

---

## 20. .env — Environment Variables

```
GROQ_API_KEY=gsk_...
GROQ_API_KEY_2=gsk_...
```
**Why `.env` file:** API keys are secrets. They should never appear in source code (which might be shared). `.env` is never committed to git. The `dotenv` package reads it at runtime and injects values into `process.env`.

**Why multiple Groq keys:** Each key has a 100,000 token daily limit. With 6 keys from 3 accounts, JARVIS has 600,000+ tokens per day before hitting any limits.

---

## 21. How All Files Connect Together

Here is the complete data flow for a voice command like **"play Imagine Dragons on Spotify"**:

```
1. BROWSER MIC
   └─ speech.js: getUserMedia → SpeechRecognition → transcript: "play Imagine Dragons on Spotify"

2. FRONTEND ROUTING
   └─ chat.js: sendMessage() called
   └─ system.js: handleSystemCommand("play Imagine Dragons on Spotify")
   └─ system.js: detectMusicIntent() → returns TRUE
   └─ system.js: handleMusicCommand() called

3. PLATFORM DETECTION
   └─ system.js: _PLATFORM_RE matches "on Spotify"
   └─ platform = 'spotify', songQuery = 'Imagine Dragons'

4. BACKEND CALL
   └─ fetch('/api/spotify', { action: 'search-play', query: 'Imagine Dragons' })
   └─ server.js: /api/spotify route handler
   └─ exec: `start "" "spotify:search:Imagine Dragons"` → opens Spotify app
   └─ PowerShell script: focuses Spotify window, sends {DOWN}{ENTER} to auto-select

5. RESPONSE
   └─ server.js: returns { success: true, message: "Opening Spotify..." }
   └─ system.js: addMessage('ai', "Opening Spotify for 'Imagine Dragons', Boss...")
   └─ chat.js: addMessage() called
   └─ tts.js: speak("Opening Spotify...") → SpeechSynthesis reads it aloud
   └─ UI: message appears in chat

6. STATE UPDATE
   └─ window._spotifyOpen = true (future "next"/"pause" commands route to Spotify controls)
```

---

**End of CODEBASE Documentation**

*Written for Balaji — owner and creator of JARVIS.*
