// ═══════════════════════════════════════════════
// JARVIS — App Init
// ═══════════════════════════════════════════════

window.addEventListener('load', () => {
  loadProfile();
  loadLanguage();
  loadConversationHistory();
  loadFeatureData();
  updateContextBar();

  // Refresh voice cache after browser finishes loading
  setTimeout(() => { _cachedVoices = window.speechSynthesis?.getVoices() || []; }, 600);

  // Trigger identity verification overlay
  if (typeof initVerification === 'function') initVerification();

  // Restore conversation history from Supabase DB (gives JARVIS memory across reloads)
  setTimeout(restoreSessionFromDB, 800);
});

// ── Restore from Supabase DB on load ─────────────────────────────────────────
// Loads the last 20 turns from the server so JARVIS has full context immediately.
// Runs after profile is loaded so userProfile.name is available.
async function restoreSessionFromDB() {
  // Only restore if the page is completely fresh (no messages yet)
  if (conversationHistory.length > 0) return;

  const userName = (userProfile?.name || 'balaji').toLowerCase().replace(/\s+/g, '_');
  try {
    const resp = await fetch(`/api/history?userId=${encodeURIComponent(userName)}&limit=20`);
    if (!resp.ok) return;
    const { history } = await resp.json();
    if (!history || history.length === 0) return;

    // Re-populate the in-memory conversation array used by callJarvis()
    conversationHistory = history.map(h => ({
      role:    h.role,
      content: h.content
    }));

    // Show a subtle restore notice — don't re-render all messages (too noisy on load)
    const msgs = document.getElementById('messages');
    if (msgs) {
      const notice = document.createElement('div');
      notice.className = 'msg ai';
      notice.style.cssText = 'opacity:0.55;';
      notice.innerHTML = `
        <div class="avatar ai">⬡</div>
        <div class="bubble ai" style="font-size:11px;padding:6px 12px;">
          <em>Memory restored — ${history.length} previous messages loaded. JARVIS remembers our conversation, Boss.</em>
          &nbsp;<button onclick="this.closest('.msg').remove()" style="border:none;background:none;color:var(--accent);cursor:pointer;font-size:10px;">✕ dismiss</button>
        </div>`;
      msgs.insertBefore(notice, msgs.firstChild);
    }
  } catch (_) {
    // Non-critical — JARVIS still works without DB history
  }
}

// Auto-save every 5 minutes
setInterval(autoSaveConversation, 300_000);

// Save before leaving
window.addEventListener('beforeunload', () => {
  if (conversationHistory.length > 0)
    saveConversation(`Auto-saved before close ${new Date().toLocaleTimeString()}`);
});
