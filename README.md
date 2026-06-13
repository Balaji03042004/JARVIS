# JARVIS — NEXUS AI Assistant
### Built & Owned by Balaji · Version 1.0.0

---

## What Is This Application?

**JARVIS (NEXUS)** is a fully local, voice-controlled AI assistant that runs on your own computer. It is inspired by the AI from Iron Man — sharp, efficient, and obedient only to its creator.

Unlike cloud-based assistants (Siri, Alexa, Google Assistant), JARVIS runs on **your machine** using a lightweight Node.js server. It connects to free AI APIs (Groq, Gemini, OpenRouter) for intelligence but keeps all your files, commands, and data on your own system. No data is sent anywhere except to the AI providers for generating responses.

---

## What This Application Can Do

| Feature | What It Does |
|---|---|
| 💬 **AI Chat** | Talk to a powerful LLM (Llama 3.3 70B). Ask anything. Get instant answers. |
| 🎤 **Voice Control** | Speak to JARVIS hands-free. It listens, understands, and responds by voice. |
| 🔊 **Text-to-Speech** | JARVIS reads every response aloud using your browser's voice engine. |
| 🎵 **Music Playback** | Say "play [song] on YouTube/Spotify" — JARVIS plays it right inside the app. |
| 📂 **File System Access** | List drives, browse folders, check file sizes — just ask. |
| 🌐 **Web Browsing** | Say "open Google" or "search for..." — JARVIS opens it in your browser. |
| 🖥️ **App Launcher** | Say "open Notepad", "open VS Code" — JARVIS launches apps on your PC. |
| ⚡ **Run Commands** | Say "run ipconfig" or "shutdown" — JARVIS executes shell commands. |
| 📍 **GPS Location** | Say "where am I?" — JARVIS fetches your GPS coordinates via browser. |
| 🔐 **Boss Verification** | Identity check at startup — full power only for Balaji. |
| 🧠 **Multi-Mode AI** | Switch between General AI, Code Writer, iBPS Expert, Debug Engine, SQL Optimizer. |
| 🌏 **Multi-Language** | Supports English, Tamil, Hindi, Spanish, French, German, Japanese, Korean. |
| 💾 **Conversation Save** | Auto-saves chat history. Review, resume, or delete past conversations. |
| 🎛️ **Noise Filtering** | Audio pipeline with echo cancellation + noise gate for clean voice recognition. |
| 🔧 **Feature Builder** | Ask JARVIS to build new features for itself using the Dev Modal. |

---

## Technology Stack

### Backend (Server)

| Technology | Why It Was Chosen |
|---|---|
| **Node.js** | Fast, lightweight JavaScript runtime. Runs locally with minimal resources. |
| **Express.js** | Simple HTTP server framework. Easy to create API endpoints (routes) for each feature. |
| **dotenv** | Loads secret API keys from `.env` file. Keys never appear in source code. |
| **undici** | High-performance HTTP client for fetching YouTube pages. Faster than built-in `fetch`. |
| **node-fetch** | Used for standard API calls (Groq, Gemini, OpenRouter). OpenAI-compatible `fetch`. |
| **cors** | Allows the frontend (browser) to talk to the backend (Node.js) without security errors. |
| **fs (built-in)** | Node.js file system module. Used to read/write/list files on your PC. |
| **os (built-in)** | Gets system info — RAM, hostname, platform, home directory. |
| **child_process (built-in)** | Runs shell commands like PowerShell scripts for Spotify automation. |

### Frontend (Browser)

| Technology | Why It Was Chosen |
|---|---|
| **Vanilla JavaScript** | No framework needed. Keeps it fast, small, and easy to understand and modify. |
| **Web Speech API** | Browser's built-in speech recognition. No external service needed for voice input. |
| **SpeechSynthesis API** | Browser's built-in text-to-speech. JARVIS's voice runs entirely in your browser. |
| **YouTube IFrame API** | Embeds YouTube player directly in JARVIS. Controlled programmatically. |
| **Web Audio API + getUserMedia** | Captures microphone audio with noise suppression, echo cancellation, auto-gain. |
| **Geolocation API** | Browser built-in GPS. Gets coordinates when you ask "where am I?". |
| **localStorage** | Saves your profile, settings, and conversation history locally in the browser. |
| **CSS Custom Properties** | Variables like `--primary`, `--green`, `--bg` for consistent, easily themeable UI. |

### AI Providers (Free Tier)

| Provider | Model | Free Limit | Fallback Order |
|---|---|---|---|
| **Groq** | Llama 3.3 70B Versatile | 100,000 tokens/day per key | 1st (primary) |
| **Google Gemini** | gemini-2.0-flash | 1,500 requests/day per key | 2nd (automatic) |
| **OpenRouter** | meta-llama/llama-3.3-70b-instruct:free | Unlimited on free tier | 3rd (ultimate fallback) |

---

## Project Folder Structure

```
nexus-app/
│
├── server.js              ← Main backend server (all API routes)
├── package.json           ← Project config and npm dependencies
├── .env                   ← Secret API keys (never commit this to git)
├── restart.bat            ← Double-click to restart the server on Windows
│
├── public/                ← Everything the browser loads
│   ├── index.html         ← The entire UI (single page application)
│   │
│   ├── js/                ← All JavaScript logic (split by responsibility)
│   │   ├── config.js      ← Constants: system prompts, mode labels, languages
│   │   ├── state.js       ← Global variables (mode, language, profile, etc.)
│   │   ├── app.js         ← App initializer (runs on page load)
│   │   ├── ui.js          ← UI helpers: setStatus, setMode, clearChat, language
│   │   ├── chat.js        ← Message rendering, sendMessage(), markdown parser
│   │   ├── tts.js         ← Text-to-speech: speak(), stopSpeaking(), voice selector
│   │   ├── speech.js      ← Voice input: mic, hands-free mode, noise gate, interrupt
│   │   ├── profile.js     ← User profile: load, save, update UI
│   │   ├── verify.js      ← Identity verification overlay (Boss mode gate)
│   │   ├── voice.js       ← Voice change commands ("switch to female voice")
│   │   ├── system.js      ← Local system commands (music, apps, browse, files, GPS)
│   │   ├── filesystem.js  ← File/folder listing and drive browsing
│   │   ├── music-player.js← YouTube embedded player (IFrame API wrapper)
│   │   ├── conversations.js← Save/load/delete conversation history
│   │   ├── features.js    ← Feature request and development system
│   │   ├── sentiment.js   ← Sentiment analysis, intent detection, entity extraction
│   │   └── temples.js     ← Temple data feature (domain-specific)
│   │
│   └── css/               ← All styling (split by concern)
│       ├── variables.css  ← CSS custom properties (colors, fonts, sizes)
│       ├── layout.css     ← Page structure: grid, panels, sidebar
│       ├── chat.css       ← Message bubbles, avatars, code blocks
│       ├── components.css ← Buttons, inputs, music player, mic meter
│       ├── modals.css     ← Overlay panels (verify, dev modal, profile)
│       └── animations.css ← Glows, transitions, pulse effects
│
├── README.md              ← This file
└── CODEBASE.md            ← Detailed code documentation
```

---

## How To Run

### Step 1 — Install Node.js
Download from https://nodejs.org (choose LTS version)

### Step 2 — Install dependencies
```bash
cd d:\nexus-app
npm install
```

### Step 3 — Set up API keys
Open `.env` and ensure at least one Groq key is present:
```
GROQ_API_KEY=gsk_your_key_here
```
Get free keys at: https://console.groq.com/keys

### Step 4 — Start the server
```bash
node server.js
```
Or double-click `restart.bat`

### Step 5 — Open in browser
Go to: **http://localhost:3000**

Use **Chrome** for best voice recognition support.

---

## WhatsApp Integration (Official Cloud API)

JARVIS now supports official WhatsApp webhook commands through Meta's WhatsApp Business Cloud API.

### Required `.env` values

```env
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAG...your_permanent_or_long_lived_token...
WHATSAPP_VERIFY_TOKEN=your_custom_verify_token

# Optional safety controls
WHATSAPP_ALLOWED_NUMBERS=919876543210,911234567890
WHATSAPP_REQUIRE_CONFIRM=true
WHATSAPP_CONFIRM_WINDOW_MS=120000
WHATSAPP_API_VERSION=v21.0
```

### Webhook settings in Meta App Dashboard

1. Webhook URL: `https://<your-public-domain>/api/whatsapp/webhook`
2. Verify Token: same value as `WHATSAPP_VERIFY_TOKEN`
3. Subscribe to `messages` field

For local testing, expose your local server with ngrok or Cloudflare tunnel and use that HTTPS URL.

### WhatsApp command format

- `help`
- `system info`
- `list apps`
- `open app notepad`
- `open github.com`
- `open site youtube`
- `run whoami`
- `confirm <id>` / `cancel <id>` (for protected actions)

### Safety behavior

- Only text messages are executed.
- `run` and `open app` require confirmation by default.
- Allow-list can restrict command execution to specific WhatsApp numbers.
- Pending approvals auto-expire.

---

## How To Get More Free API Keys

### Groq (Primary — fastest)
1. Go to https://console.groq.com/keys
2. Create a free account
3. Generate a key
4. Add to `.env` as `GROQ_API_KEY_7=...`

### Google Gemini (Fallback #1)
1. Go to https://aistudio.google.com/app/apikey
2. Sign in with any Google account
3. Click "Create API Key"
4. Add to `.env` — uncomment `GEMINI_API_KEY=...`

### OpenRouter (Fallback #2 — unlimited free models)
1. Go to https://openrouter.ai/keys
2. Create a free account
3. Generate key
4. Add to `.env` — uncomment `OPENROUTER_API_KEY=...`

When all Groq keys hit the daily limit, JARVIS **automatically** switches to Gemini, then OpenRouter. No action needed.

---

## Voice Commands Reference

| What You Say | What Happens |
|---|---|
| "play [song name]" | Searches YouTube and plays in embedded player |
| "play [song] on Spotify" | Opens Spotify desktop app and auto-plays |
| "next" / "previous" | Next/previous track |
| "pause" / "resume" | Pause/resume current music |
| "stop music" | Stops and closes the player |
| "open [app name]" | Launches the app on your PC |
| "run [command]" | Runs it in PowerShell/CMD |
| "list C drive" | Shows contents of C:\ |
| "show downloads folder" | Lists your Downloads |
| "open Google" | Opens google.com in browser |
| "search for [query]" | Web search |
| "where am I?" | Shows your GPS location |
| "system info" | RAM, CPU, OS details |
| "change to female voice" | Switches JARVIS's speaking voice |

---

## Settings & Profile

Click the **👤 Profile** panel (top right) to:
- Set your name (for Boss verification)
- Toggle Boss-only voice commands (only your voice works)
- Adjust mic noise filter sensitivity
- Train JARVIS with custom instructions
- Change voice, language, preferences

---

## Security Notes

- **All data stays local** — your files, commands, and history never leave your machine
- **API keys** are in `.env` which is never shared or committed to git
- **SSL validation** is disabled (`NODE_TLS_REJECT_UNAUTHORIZED=0`) only for local API calls
- **Boss mode** prevents unauthorized users from issuing system commands via voice

---

## Author

**Designed and built by Balaji**
JARVIS is a personal AI assistant — owned, trained, and operated exclusively by Balaji.
