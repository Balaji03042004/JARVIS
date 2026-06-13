// ═══════════════════════════════════════════════
// JARVIS — Conversation Storage
// ═══════════════════════════════════════════════

const MAX_CONVERSATIONS  = 30;   // hard cap on saved conversations
const MAX_MSG_CHARS      = 2000; // truncate very long AI messages when storing
const AUTO_SAVE_PREFIX   = 'Auto-saved';

// ── Safe localStorage write — trims oldest entries if quota exceeded ──────────
function _safeSetConversations(list) {
  let trimmed = list;
  for (let attempts = 0; attempts < 10; attempts++) {
    try {
      // Slim down: strip profile, truncate long messages
      const slim = trimmed.map(c => ({
        id:        c.id,
        title:     c.title,
        timestamp: c.timestamp,
        language:  c.language,
        messages:  (c.messages || []).map(m => ({
          role:    m.role,
          content: (m.content || '').length > MAX_MSG_CHARS
            ? m.content.slice(0, MAX_MSG_CHARS) + '…[truncated]'
            : m.content
        }))
      }));
      localStorage.setItem('jarvisConversations', JSON.stringify(slim));
      allConversations = list;   // keep full in-memory
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        // Drop the oldest entry and retry
        if (trimmed.length > 1) {
          trimmed = trimmed.slice(1);
        } else {
          // Nothing left to trim — clear entirely
          localStorage.removeItem('jarvisConversations');
          allConversations = [];
          return false;
        }
      } else {
        console.error('[JARVIS] Storage error:', e);
        return false;
      }
    }
  }
  return false;
}

function saveConversation(title) {
  if (!conversationHistory.length) return;
  const conv = {
    id:        Date.now(),
    title:     title || `Chat ${new Date().toLocaleString()}`,
    timestamp: new Date().toLocaleString(),
    language:  currentLanguage,
    messages:  conversationHistory
  };
  allConversations.push(conv);
  // Hard cap — drop oldest when over limit
  if (allConversations.length > MAX_CONVERSATIONS) {
    allConversations = allConversations.slice(-MAX_CONVERSATIONS);
  }
  _safeSetConversations(allConversations);
  updateConversationList();
}

function loadConversationHistory() {
  const saved = localStorage.getItem('jarvisConversations');
  if (saved) { try { allConversations = JSON.parse(saved); } catch(e) {} }
  updateConversationList();
}

function updateConversationList() {
  const convList = document.getElementById('convList');
  if (!convList) return;
  if (!allConversations.length) {
    convList.innerHTML = `<span style="color:var(--text-muted);font-size:11px;">No saved conversations yet.</span>`;
    return;
  }
  convList.innerHTML = allConversations.slice().reverse().map((conv, rIdx) => {
    const idx = allConversations.length - 1 - rIdx;
    return `<div class="conv-item" onclick="loadConversation(${idx})">
      <div class="conv-time">🕐 ${conv.timestamp}</div>
      <div class="conv-preview">${conv.title}</div>
      <div class="conv-time">${conv.messages.length} messages · ${(conv.language||'en').toUpperCase()}</div>
    </div>`;
  }).join('');
}

function loadConversation(idx) {
  const conv = allConversations[idx];
  if (!conv) return;
  conversationHistory = conv.messages;
  currentLanguage     = conv.language || 'en';
  document.getElementById('messages').innerHTML = '';
  conv.messages.forEach(msg => {
    if (msg.role === 'user') {
      addMessage('user', msg.content);
    } else {
      addEnhancedMessage('ai', msg.content, analyzeSentiment(msg.content), detectIntent(msg.content), extractEntities(msg.content));
    }
  });
  toggleConversationHistory();
}

function exportAllConversations() {
  const json = JSON.stringify(allConversations, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jarvis-conversations-${Date.now()}.json`;
  a.click();
}

function clearAllConversations() {
  if (!confirm('⚠️ Delete ALL saved conversations? This cannot be undone.')) return;
  allConversations = [];
  localStorage.setItem('jarvisConversations', JSON.stringify([]));
  updateConversationList();
}

function toggleConversationHistory() {
  const el = document.getElementById('convHistory');
  if (el) { el.classList.toggle('open'); updateConversationList(); }
}

// ── Auto-save: UPDATE existing auto-save for this session, don't append ───────
let _autoSaveId = null;   // tracks the id of the current session's auto-save entry

function autoSaveConversation() {
  if (!conversationHistory.length) return;

  if (_autoSaveId) {
    // Update the existing auto-save entry in place
    const idx = allConversations.findIndex(c => c.id === _autoSaveId);
    if (idx !== -1) {
      allConversations[idx].messages  = conversationHistory;
      allConversations[idx].timestamp = new Date().toLocaleString();
      allConversations[idx].title     = `${AUTO_SAVE_PREFIX} ${new Date().toLocaleTimeString()}`;
      _safeSetConversations(allConversations);
      updateConversationList();
      return;
    }
  }

  // First auto-save of this session — create a new entry
  const conv = {
    id:        Date.now(),
    title:     `${AUTO_SAVE_PREFIX} ${new Date().toLocaleTimeString()}`,
    timestamp: new Date().toLocaleString(),
    language:  currentLanguage,
    messages:  conversationHistory
  };
  _autoSaveId = conv.id;
  allConversations.push(conv);
  if (allConversations.length > MAX_CONVERSATIONS) {
    allConversations = allConversations.slice(-MAX_CONVERSATIONS);
  }
  _safeSetConversations(allConversations);
  updateConversationList();
}

