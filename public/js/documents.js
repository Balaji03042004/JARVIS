// ═══════════════════════════════════════════════
// JARVIS — Document Intelligence (v1)
// Upload PDF/DOCX/TXT → JARVIS learns & answers
// ═══════════════════════════════════════════════

// Currently loaded documents (survives the session, reset on page reload)
let loadedDocuments = []; // [{ docId, name, charCount, truncated, preview }]

const ALLOWED_EXTS = ['.pdf','.docx','.txt','.md','.csv','.json','.xml',
                      '.html','.js','.java','.py','.ts','.cs','.cpp','.c',
                      '.rb','.go','.rs','.kt','.swift'];

// ── Trigger file picker ───────────────────────────────────────────────────────
function triggerDocumentUpload() {
  const input = document.getElementById('docFileInput');
  if (input) input.click();
}

// ── Called when user selects file(s) ─────────────────────────────────────────
async function handleDocFileSelect(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  // Reset input so re-selecting same file works
  event.target.value = '';

  for (const file of files) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      _docNotify(`❌ "${file.name}" — unsupported type. Use PDF, DOCX, TXT, MD, or code files.`, 'error');
      continue;
    }
    await _uploadOneDoc(file);
  }
}

// ── Upload a single file ──────────────────────────────────────────────────────
async function _uploadOneDoc(file) {
  _docNotify(`📤 Uploading "${file.name}"…`, 'info');
  _setAttachBtnLoading(true);

  try {
    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch('/api/upload-document', { method: 'POST', body: formData });
    const data = await resp.json();

    if (!resp.ok || !data.success) {
      _docNotify(`❌ Upload failed: ${data.error || 'Unknown error'}`, 'error');
      return;
    }

    loadedDocuments.push({
      docId:     data.docId,
      name:      data.name,
      charCount: data.charCount,
      truncated: data.truncated,
      preview:   data.preview
    });

    _renderDocChips();
    const sizeLabel = data.charCount > 1000
      ? `${Math.round(data.charCount / 1000)}k chars`
      : `${data.charCount} chars`;
    _docNotify(
      `✅ "${data.name}" loaded (${sizeLabel}${data.truncated ? ', large file truncated to 120k' : ''})` +
      ` — JARVIS will now answer from this document.`,
      'success'
    );
  } catch (err) {
    _docNotify(`❌ Upload error: ${err.message}`, 'error');
  } finally {
    _setAttachBtnLoading(false);
  }
}

// ── Remove a document ─────────────────────────────────────────────────────────
async function removeDocument(docId) {
  try {
    await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
  } catch (_) { /* server may have restarted, still remove from UI */ }

  const doc = loadedDocuments.find(d => d.docId === docId);
  loadedDocuments = loadedDocuments.filter(d => d.docId !== docId);
  _renderDocChips();
  if (doc) _docNotify(`🗑️ "${doc.name}" removed from context.`, 'info');
}

// ── Get IDs to send to /api/chat ──────────────────────────────────────────────
function getDocumentIds() {
  return loadedDocuments.map(d => d.docId);
}

function hasDocumentsLoaded() {
  return loadedDocuments.length > 0;
}

// ── Render document chips above the input area ────────────────────────────────
function _renderDocChips() {
  const bar = document.getElementById('docChipsBar');
  if (!bar) return;

  if (!loadedDocuments.length) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = loadedDocuments.map(doc => {
    const size = doc.charCount > 1000
      ? `${Math.round(doc.charCount / 1000)}k`
      : `${doc.charCount}`;
    const truncBadge = doc.truncated
      ? `<span style="color:#ff9800;font-size:9px;margin-left:3px" title="File was truncated to 120k chars">⚠</span>`
      : '';
    return `
      <div class="doc-chip" title="${_escHtml(doc.preview || doc.name)}">
        <span class="doc-chip-icon">${_docIcon(doc.name)}</span>
        <span class="doc-chip-name">${_escHtml(doc.name)}</span>
        <span class="doc-chip-size">${size}</span>
        ${truncBadge}
        <button class="doc-chip-remove" onclick="removeDocument('${doc.docId}')" title="Remove document">✕</button>
      </div>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _docIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = { pdf: '📄', docx: '📝', doc: '📝', txt: '📃', md: '📃',
                  csv: '📊', json: '📋', xml: '📋', html: '🌐',
                  js: '🟨', ts: '🔷', java: '☕', py: '🐍',
                  cs: '🔷', cpp: '⚙️', c: '⚙️', rb: '💎',
                  go: '🐹', rs: '🦀', kt: '🟣', swift: '🦅' };
  return icons[ext] || '📄';
}

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _setAttachBtnLoading(on) {
  const btn = document.getElementById('attachBtn');
  if (!btn) return;
  btn.textContent = on ? '⏳' : '📎';
  btn.disabled = on;
}

// ── Inline notification in chat area ─────────────────────────────────────────
function _docNotify(msg, type) {
  // Show as a system message in the chat
  const msgs = document.getElementById('messages');
  if (!msgs) { console.log('[DOC]', msg); return; }
  const div = document.createElement('div');
  div.className = 'msg doc-notify';
  const colors = { success: '#00c853', error: '#ff5252', info: '#00d4ff' };
  div.innerHTML = `
    <div style="padding:7px 14px;margin:4px 0 4px 40px;border-radius:6px;
      font-size:12px;font-family:var(--font-mono);color:${colors[type] || colors.info};
      background:rgba(0,0,0,0.25);border-left:3px solid ${colors[type] || colors.info};
      max-width:580px">${_escHtml(msg)}</div>`;
  msgs.appendChild(div);
  // Scroll to bottom
  const chat = document.getElementById('chatArea') || document.querySelector('.chat-area');
  if (chat) chat.scrollTop = chat.scrollHeight;
}
