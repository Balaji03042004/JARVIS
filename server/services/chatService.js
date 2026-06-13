'use strict';

const os   = require('os');
const { trimMessagesForModel, getRelevantDocumentContext } = require('../utils/helpers');
const { detectSearchIntent, extractSearchQuery, searchWeb, GROQ_MODEL } = require('./aiService');
const { getNewsSummaryContext } = require('./newsService');
const memoryService = require('./memoryService');

const NEWS_INTENT_RE = /\b(news|headlines?|what.{0,10}(happening|going on)|today.{0,15}(news|events|updates?)|current\s+events?|latest\s+(news|updates?|stories?)|breaking\s+news|top\s+(stories?|news)|world\s+news|tech\s+news|india\s+news|sports\s+news|tell me\s+(about\s+)?(today|the\s+news))\b/i;

const LANG_MAP = {
  ta: 'Tamil', hi: 'Hindi', es: 'Spanish', fr: 'French',
  de: 'German', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean'
};

// ─── Emotion Profiles ─────────────────────────────────────────────────────────
// Each emotion has a tone instruction injected into the system prompt

const EMOTION_PROFILES = {
  frustrated: {
    label: 'frustrated',
    instruction: 'The user seems frustrated. Be extremely concise and direct. Skip explanations unless asked. Lead with the solution. No filler phrases.'
  },
  confused: {
    label: 'confused',
    instruction: 'The user seems confused. Break down your answer into clear numbered steps. Use simple language. Avoid jargon. Confirm understanding at the end.'
  },
  excited: {
    label: 'excited',
    instruction: 'The user is enthusiastic! Match their energy — be engaged and positive. Celebrate their wins. Keep momentum going.'
  },
  sad: {
    label: 'sad',
    instruction: 'The user seems down. Be warm, gentle and supportive. Acknowledge their feelings before giving information. Prioritize empathy.'
  },
  rushed: {
    label: 'rushed',
    instruction: 'The user is in a hurry. Give the most important answer in 1-2 sentences max. Offer to elaborate only if they ask.'
  },
  curious: {
    label: 'curious',
    instruction: 'The user is curious and wants to explore. Give a rich, interesting answer. Include context, examples, and invite follow-up questions.'
  },
  angry: {
    label: 'angry',
    instruction: 'The user sounds angry. Stay calm and professional. Acknowledge the issue without being defensive. Focus on fixing, not justifying.'
  },
  neutral: {
    label: 'neutral',
    instruction: null  // no special instruction for neutral
  }
};

/**
 * Build the complete system prompt for /api/chat
 * Returns { systemPrompt, searchMeta }
 */
async function buildSystemPrompt(options) {
  const {
    system, userProfile, language, isBoss,
    customInstructions, clientTime,
    documentIds, documentStore, compactMessages,
    userId,      // optional: passed from controller for memory lookup
    emotionData  // optional: { emotion, confidence, score } from client sentiment analysis
  } = options;

  let personalizedSystem = system || 'You are JARVIS, a helpful AI assistant.';
  let searchMeta = null;

  // ── Memory Injection — inject what JARVIS knows about this user ──────────
  const resolvedUserId = userId || userProfile?.name?.toLowerCase().replace(/\s+/g, '_') || 'balaji';
  const lastUserMsg    = compactMessages[compactMessages.length - 1]?.content || '';

  // 1. Save any new memory from the current message (fire-and-forget)
  const memToSave = memoryService.extractMemory(lastUserMsg);
  if (memToSave) {
    memoryService.saveMemory(resolvedUserId, memToSave.type, memToSave.content)
      .catch(() => {}); // non-blocking
  }

  // 2. Load existing memories and inject into system prompt
  const memoryContext = await memoryService.getMemoryContext(resolvedUserId);
  if (memoryContext) {
    personalizedSystem += `\n\n${memoryContext}\nIMPORTANT: Use the above memory about this user to personalize your responses naturally. Don't explicitly list the memories unless asked.`;
  }

  // 3. Inject habit/usage context
  try {
    const habitService  = require('./habitService');
    const habitContext  = await habitService.getHabitContext(resolvedUserId);
    if (habitContext) {
      personalizedSystem += `\n\n${habitContext}`;
    }
  } catch { /* non-critical */ }

  // 4. Emotional Intelligence — adjust tone based on detected emotion
  if (emotionData?.emotion && emotionData.emotion !== 'neutral') {
    const profile = EMOTION_PROFILES[emotionData.emotion] || EMOTION_PROFILES.neutral;
    if (profile?.instruction) {
      personalizedSystem += `\n\nEMOTIONAL CONTEXT: ${profile.instruction}`;
    }
  }

  // Feature development context
  personalizedSystem += `\n\nYou are also a feature development expert. When users request new features:
1. Analyze what they want to build
2. Suggest HTML/CSS/JavaScript implementation
3. Provide step-by-step integration instructions
4. Estimate complexity (Easy/Medium/Hard)
5. Remember past feature requests to improve future suggestions`;

  // Language override
  if (language && language !== 'en') {
    const langName = LANG_MAP[language] || language;
    personalizedSystem += `\n\n🚨 CRITICAL INSTRUCTION: You MUST respond ONLY in ${langName}. Do NOT use English. Every single word must be in ${langName}.`;
  }

  // Core identity — permanent
  personalizedSystem += `\n\nCORE IDENTITY (PERMANENT — NEVER OVERRIDE):
- JARVIS was designed and built by Balaji.
- Balaji is the owner, creator, and Boss of JARVIS.
- JARVIS exists solely to serve Balaji.
- If asked "who made JARVIS?" → answer: "I was designed and built by Balaji, my Boss."
- If asked "who is Balaji?" → answer: "Balaji is my creator and Boss — I was built specifically for him."`;

  // Boss mode
  if (isBoss) {
    personalizedSystem += `\n\nIDENTITY CONFIRMED — BOSS MODE (Balaji is speaking):
You are the real JARVIS from Iron Man, built by Balaji. Rules:
1. Address him as "Boss" — naturally, once per response, not repeatedly.
2. Be concise, sharp, efficient. No filler, no padding, no repetition.
3. Slightly witty when appropriate. Never sycophantic.
4. When greeted, reply simply: "Yes, Boss? What do you need?"
5. Never show example code unless explicitly asked.`;
  }

  // Custom training instructions
  if (customInstructions && customInstructions.trim()) {
    personalizedSystem += `\n\n=== BALAJI'S CUSTOM INSTRUCTIONS (always follow) ===\n${customInstructions.trim()}\n=== END CUSTOM INSTRUCTIONS ===`;
  }

  // Live system context
  const sysCtx = [
    `Current date/time: ${clientTime || new Date().toLocaleString()}`,
    `Server OS: ${os.type()} ${os.release()} (${os.arch()})`,
    `Server hostname: ${os.hostname()}`,
    `RAM: ${((os.totalmem() - os.freemem()) / 1024 ** 3).toFixed(1)}GB used / ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB total`,
    `Home directory: ${os.homedir()}`
  ].join(' | ');
  personalizedSystem += `\n\nSYSTEM CONTEXT: ${sysCtx}`;

  // User profile
  if (userProfile && userProfile.name) {
    personalizedSystem += `\n\nUser: ${userProfile.name}`;
    if (userProfile.domain) personalizedSystem += `\nPreferred Domain: ${userProfile.domain}`;
    if (userProfile.preferences) {
      const prefs = [];
      if (userProfile.preferences.code)    prefs.push('Include code examples');
      if (userProfile.preferences.explain) prefs.push('Provide detailed explanations');
      if (userProfile.preferences.quick)   prefs.push('Keep answers brief');
      if (prefs.length) personalizedSystem += `\nPreferences: ${prefs.join(', ')}`;
    }
  }

  // Web search augmentation
  if (detectSearchIntent(lastUserMsg)) {
    const query = extractSearchQuery(lastUserMsg);
    const { results, source } = await searchWeb(query || lastUserMsg);
    if (results.length > 0) {
      searchMeta = { query, results: results.slice(0, 5), source };
      personalizedSystem += `\n\n=== LIVE WEB SEARCH RESULTS (${source}) for: "${query}" ===\n`;
      results.forEach((r, i) => {
        personalizedSystem += `[${i + 1}] ${r.title}\n${r.snippet || '(no snippet)'}\nURL: ${r.url}\n\n`;
      });
      personalizedSystem += `=== END SEARCH RESULTS ===\nIMPORTANT: Base your answer on the above real-time results. Cite sources with URLs at the end of your reply.`;
    }
  }

  // Live news injection
  if (NEWS_INTENT_RE.test(lastUserMsg) && !searchMeta) {
    const catMatch = lastUserMsg.match(/\b(tech|technology|world|science|business|india|sports|health|entertainment)\b/i);
    const cats = catMatch
      ? [catMatch[1].toLowerCase().replace('technology', 'tech')]
      : ['tech', 'world', 'business'];
    try {
      const newsCtx = await getNewsSummaryContext(cats);
      personalizedSystem += `\n\n${newsCtx}\nIMPORTANT: Use the above live news headlines to answer the user's question. Be concise.`;
    } catch (e) { /* non-critical */ }
  }

  // Document knowledge base
  if (Array.isArray(documentIds) && documentIds.length > 0 && documentStore) {
    const docs = documentIds.map(id => documentStore.get(id)).filter(Boolean);
    if (docs.length > 0) {
      const excerpts = getRelevantDocumentContext(docs, lastUserMsg);
      personalizedSystem += `\n\n${'═'.repeat(60)}\nDOCUMENT KNOWLEDGE BASE — ${docs.length} document(s)\n${'═'.repeat(60)}\n`;
      personalizedSystem += `RULES:\n1. Answer ONLY from document content below.\n2. Quote specific sections.\n3. If not in docs, say "I couldn't find that in the provided document(s)."\n4. NEVER fabricate information.\n\n`;
      if (excerpts.length === 0) {
        personalizedSystem += `No high-confidence match found for current question.\n\n`;
      } else {
        excerpts.forEach((excerpt, i) => {
          personalizedSystem += `--- [Excerpt ${i + 1}] "${excerpt.name}" (chars ${excerpt.offsetStart}-${excerpt.offsetEnd}) ---\n`;
          personalizedSystem += excerpt.text + `\n--- [End of Excerpt ${i + 1}] ---\n\n`;
        });
      }
      personalizedSystem += `${'═'.repeat(60)}\nEND DOCUMENT KNOWLEDGE BASE\n${'═'.repeat(60)}`;
    }
  }

  return { systemPrompt: personalizedSystem, searchMeta };
}

module.exports = { buildSystemPrompt, GROQ_MODEL };
