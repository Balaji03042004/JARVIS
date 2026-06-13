// ═══════════════════════════════════════════════
// JARVIS — Global Mutable State
// ═══════════════════════════════════════════════

let currentMode     = 'general';
let currentLanguage = 'en';
let isLoading       = false;
let isListening     = false;
let speakerEnabled  = true;
let isCurrentlySpeaking = false;
let recognition     = null;

let conversationHistory = [];
let allConversations    = [];

// Stable session ID — persists for the lifetime of this page session.
// Sent with every chat request so the server can group turns together.
const SESSION_ID = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

let userProfile = {
  name: 'User',
  domain: '',
  preferences: { code: true, explain: true, quick: false },
  stats: { messages: 0, sentiment: [], topics: [], feedback: [] }
};

let featureRequests      = [];
let implementedFeatures  = [];
let learningDatabase = {
  requestCount: 0,
  successfulImplementations: 0,
  userPreferences: {},
  developmentHistory: []
};

let trainingData = { features: [], searches: [], patterns: [] };
let developedFeatures = [];

let templeFilter = 'all';
let isVerifiedBoss = false;   // true after identity verification
let conversationMode = false;  // true = hands-free two-way conversation
let selectedVoiceURI = localStorage.getItem('jarvisVoiceURI') || null;
let customInstructions = localStorage.getItem('jarvisCustomInstructions') || '';

// TTS voice cache
let _cachedVoices = [];
function getCachedVoices() {
  if (_cachedVoices.length === 0) _cachedVoices = window.speechSynthesis.getVoices();
  return _cachedVoices;
}
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { _cachedVoices = window.speechSynthesis.getVoices(); };
}
