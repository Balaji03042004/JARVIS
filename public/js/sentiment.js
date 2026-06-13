// ═══════════════════════════════════════════════
// JARVIS — Sentiment, Intent, Entities, Feedback
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — Enhanced Emotional Intelligence
// Detects nuanced emotions from user messages and sends context to server
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Emotion Lexicons ─────────────────────────────────────────────────────────

const EMOTION_LEXICONS = {
  frustrated: {
    words: /(ugh|argh|seriously|again|broken|doesn'?t work|not working|won'?t|keep failing|why (won'?t|doesn'?t|can'?t)|still not|useless|annoying|frustrat|stuck|can'?t figure)/i,
    phrases: /(i'?ve tried|nothing works|i don'?t understand why|why is this|this is so)/i,
    weight: 2
  },
  confused: {
    words: /(confused|confusing|unclear|don'?t understand|what do you mean|huh\?|lost|how does|how do i|what is|explain|i'm not sure|not sure how)/i,
    phrases: /(can you explain|what does that mean|i don'?t get|help me understand)/i,
    weight: 1.5
  },
  excited: {
    words: /(amazing|awesome|wow|incredible|fantastic|love it|great|excellent|brilliant|perfect|!!+|yes!|omg|let'?s go|this is great)/i,
    phrases: /(this is so cool|i love this|that'?s awesome|this works|it worked)/i,
    weight: 1.5
  },
  sad: {
    words: /(sad|depressed|down|unhappy|upset|feeling low|bad day|terrible|awful|hopeless|worried|anxious|stressed)/i,
    phrases: /(having a bad|feeling (bad|down|sad|terrible)|not doing (well|great)|struggling with)/i,
    weight: 1.5
  },
  rushed: {
    words: /(quick|quickly|fast|urgent|asap|hurry|right now|immediately|no time|in a hurry|brief|short|just|quick question)/i,
    phrases: /(need this now|as soon as possible|in a rush|make it quick|keep it short)/i,
    weight: 1.5
  },
  curious: {
    words: /(interesting|curious|wonder|explore|what if|how about|tell me more|fascinating|learn|discover|deep dive)/i,
    phrases: /(how does this|can you tell me|i want to know|what'?s the story|walk me through)/i,
    weight: 1
  },
  angry: {
    words: /(angry|furious|mad|outraged|ridiculous|unacceptable|stupid|idiotic|hate this|terrible|worst|awful|rubbish|trash)/i,
    phrases: /(this is ridiculous|i can'?t believe|this is the worst|completely unacceptable)/i,
    weight: 2
  }
};

/**
 * Enhanced emotion detection — returns { emotion, confidence, score, secondary }
 * @param {string} text
 * @returns {{ emotion: string, confidence: number, score: number, secondary?: string }}
 */
function detectEmotion(text) {
  if (!text || text.length < 3) return { emotion: 'neutral', confidence: 0, score: 0 };

  const scores = {};

  for (const [emotion, config] of Object.entries(EMOTION_LEXICONS)) {
    let score = 0;
    if (config.words.test(text))   score += config.weight;
    if (config.phrases.test(text)) score += config.weight * 0.8;
    // Boost for exclamation/caps
    if (emotion === 'excited' && /(!{2,}|[A-Z]{4,})/.test(text)) score += 0.5;
    if (emotion === 'angry'   && /(!{2,}|[A-Z]{4,})/.test(text)) score += 0.5;
    if (score > 0) scores[emotion] = score;
  }

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return { emotion: 'neutral', confidence: 0, score: 0 };

  const [topEmotion, topScore] = entries[0];
  const secondary = entries[1]?.[0];
  const confidence = Math.min(topScore / 3, 1); // normalize to 0-1

  return {
    emotion:    topScore >= 1 ? topEmotion : 'neutral',
    confidence: Math.round(confidence * 100) / 100,
    score:      topScore,
    secondary:  secondary || null
  };
}

function analyzeSentiment(text) {
  const pos = /(happy|great|excellent|awesome|good|love|thank|helpful|perfect|wonderful|amazing)/gi;
  const neg = /(bad|hate|terrible|awful|horrible|disappointed|angry|sad|frustrated)/gi;
  const emp = /(understand|feel|sorry|support|help|care|concern)/gi;
  let score = 0;
  if (pos.test(text)) score += 1;
  if (neg.test(text)) score -= 1;
  if (emp.test(text)) score += 0.5;
  if (score > 0.5)  return { type: 'positive', emoji: '😊', label: 'Positive' };
  if (score < -0.5) return { type: 'negative', emoji: '😔', label: 'Negative' };
  return { type: 'neutral', emoji: '😐', label: 'Neutral' };
}

function calculateAvgSentiment() {
  const arr = userProfile.stats.sentiment;
  if (!arr.length) return { emoji: '😐', label: 'New' };
  const avg = arr.reduce((a,b)=>a+b,0) / arr.length;
  return avg > 0.3 ? { emoji: '😊', label: 'Positive' } : avg < -0.3 ? { emoji: '😔', label: 'Negative' } : { emoji: '😐', label: 'Neutral' };
}

function detectIntent(text) {
  const intents = {
    code:     ['write','create','generate','code','function','method','class','implement'],
    debug:    ['debug','fix','error','bug','issue','problem','troubleshoot','wrong'],
    explain:  ['explain','what is','how does','what are','define','describe'],
    optimize: ['optimize','improve','performance','faster','efficient'],
    help:     ['help','how to','how can','assist','support']
  };
  const detected = [];
  for (const [intent, kws] of Object.entries(intents)) {
    if (kws.some(kw => text.toLowerCase().includes(kw))) detected.push(intent);
  }
  return detected.length ? detected : ['general'];
}

function extractEntities(text) {
  const patterns = {
    language:  /\b(Java|JavaScript|Python|SQL|XML|JSON|C#|Go|Rust)\b/gi,
    framework: /\b(Spring|React|Vue|Angular|Express|Django|FastAPI)\b/gi,
    platform:  /\b(Newgen|iBPS|AWS|Azure|GCP|Docker|Kubernetes)\b/gi,
    database:  /\b(Oracle|MySQL|PostgreSQL|MongoDB|Redis|Cassandra)\b/gi
  };
  const entities = [];
  for (const [type, pat] of Object.entries(patterns)) {
    let m;
    while ((m = pat.exec(text)) !== null) entities.push({ text: m[0], type });
  }
  return entities;
}

function rateFeedback(btn, score) {
  btn.classList.toggle('active');
  userProfile.stats.feedback.push(score * 10);
  saveProfile();
  const orig = btn.textContent;
  btn.textContent = score === 1 ? '✓' : score === 0 ? '✗' : '⚬';
  setTimeout(() => btn.textContent = orig, 1500);
}

function updateContextBar() {
  if (!conversationHistory.length) return;
  let bar = document.querySelector('.context-bar');
  if (!bar) {
    const msgs = document.getElementById('messages');
    bar = document.createElement('div');
    bar.className = 'context-bar';
    if (msgs) msgs.insertBefore(bar, msgs.firstChild);
  }
  const topics = [...new Set(userProfile.stats.topics)].slice(-4);
  bar.innerHTML = `<span style="color:var(--text-muted);font-size:9px;">Context:</span> ` +
    (topics.length
      ? topics.map(t => `<div class="context-item"><div class="context-dot"></div><span>${t}</span></div>`).join('')
      : `<span style="color:var(--text-muted);font-size:9px;">No topics</span>`);
}
