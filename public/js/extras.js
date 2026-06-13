// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS EXTRAS — 18 new feature modules
// Features: Reminders, Tasks+Pomodoro, Notes, Password Vault, Clipboard,
//           Process Monitor, Network, Window Manager, Git, Code Runner,
//           News Feed, Breach Check, Transcription, Vision AI, Image Gen,
//           Screen Recorder, Audit Log, Telegram Bot
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Shared State ─────────────────────────────────────────────────────────────
let _toolsActiveTab     = 'reminders';
let _reminders          = [];
let _tasks              = [];
let _pomodoroTimer      = null;
let _pomodoroSecs       = 25 * 60;
let _pomodoroRunning    = false;
let _pomodoroMode       = 'work';
let _notesList          = [];
let _noteEditId         = null;
let _noteSearch         = '';
let _vaultKey           = null;
let _vaultEntries       = [];
let _clipboardHistory   = [];
const _MAX_CLIPBOARD    = 20;
let _procAllData        = [];
let _procFilter         = '';
let _procPollInterval   = null;
let _procAutoActive     = false;
let _mediaRecorder      = null;
let _recordedChunks     = [];
let _recordingActive    = false;
let _transcribeRecorder = null;
let _transcribeChunks   = [];
let _transcribeRecording = false;

// ─── Tab definitions ──────────────────────────────────────────────────────────
const _TABS = [
  { id: 'reminders',  icon: '⏰', label: 'Reminders'  },
  { id: 'tasks',      icon: '✅', label: 'Tasks'      },
  { id: 'notes',      icon: '📝', label: 'Notes'      },
  { id: 'vault',      icon: '🔐', label: 'Vault'      },
  { id: 'clipboard',  icon: '📋', label: 'Clipboard'  },
  { id: 'processes',  icon: '🖥',  label: 'Processes'  },
  { id: 'network',    icon: '🌐', label: 'Network'    },
  { id: 'windows',    icon: '🪟', label: 'Windows'    },
  { id: 'git',        icon: '🔧', label: 'Git'        },
  { id: 'coderunner', icon: '💻', label: 'Code'       },
  { id: 'news',       icon: '📰', label: 'News'       },
  { id: 'breach',     icon: '🛡',  label: 'Breach'     },
  { id: 'transcribe', icon: '🎙', label: 'Transcribe' },
  { id: 'vision',     icon: '👁',  label: 'Vision AI'  },
  { id: 'imagegen',   icon: '🖼',  label: 'Image Gen'  },
  { id: 'recorder',   icon: '📹', label: 'Recorder'   },
  { id: 'auditlog',   icon: '📜', label: 'Audit Log'  },
  { id: 'telegram',   icon: '🤖', label: 'Telegram'   },
];

// ─── Tools Panel Control ──────────────────────────────────────────────────────
function openToolsPanel(tab) {
  _toolsActiveTab = tab || _toolsActiveTab;
  const overlay = document.getElementById('toolsOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  _renderToolsTabs();
  _initTab(_toolsActiveTab);
}

function closeToolsPanel() {
  const overlay = document.getElementById('toolsOverlay');
  if (overlay) overlay.classList.remove('open');
  if (_procPollInterval) { clearInterval(_procPollInterval); _procPollInterval = null; _procAutoActive = false; }
}

function _renderToolsTabs() {
  const bar = document.getElementById('toolsTabsBar');
  if (!bar) return;
  bar.innerHTML = _TABS.map(t =>
    `<button class="tools-tab${t.id === _toolsActiveTab ? ' active' : ''}" onclick="switchToolsTab('${t.id}')" title="${t.label}">
      <span>${t.icon}</span><span class="tools-tab-label">${t.label}</span>
    </button>`
  ).join('');
}

function switchToolsTab(id) {
  if (_procPollInterval) { clearInterval(_procPollInterval); _procPollInterval = null; _procAutoActive = false; }
  _toolsActiveTab = id;
  document.querySelectorAll('.tools-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tools-tab').forEach(t => { if (t.title === _TABS.find(x => x.id === id)?.label) t.classList.add('active'); });
  _initTab(id);
}

function _initTab(id) {
  const body = document.getElementById('toolsBody');
  if (!body) return;
  const map = {
    reminders: _renderReminders, tasks: _renderTasks, notes: _renderNotes,
    vault: _renderVault, clipboard: _renderClipboard, processes: _renderProcesses,
    network: _renderNetwork, windows: _renderWindows, git: _renderGit,
    coderunner: _renderCodeRunner, news: _renderNews, breach: _renderBreach,
    transcribe: _renderTranscribe, vision: _renderVision, imagegen: _renderImageGen,
    recorder: _renderRecorder, auditlog: _renderAuditLog, telegram: _renderTelegram
  };
  if (map[id]) map[id](body);
}

// ═══════════════════════════════════════════════
// 1. REMINDERS
// ═══════════════════════════════════════════════
function _renderReminders(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">⏰ Reminders</h3>
      <div class="t-row">
        <input id="reminderText" class="t-input" placeholder="Reminder text..." style="flex:1"/>
        <input id="reminderTime" class="t-input" type="datetime-local" style="width:200px"/>
        <button class="t-btn t-btn-primary" onclick="_addReminder()">+ Add</button>
      </div>
      <div id="reminderList" class="t-list" style="margin-top:8px">Loading...</div>
    </div>`;
  _loadReminders();
}

async function _loadReminders() {
  try {
    const r = await fetch('/api/reminders').then(x => x.json());
    _reminders = r.reminders || [];
    _displayReminders();
  } catch { const el = document.getElementById('reminderList'); if (el) el.innerHTML = '<div class="t-err">Could not load reminders</div>'; }
}

function _displayReminders() {
  const el = document.getElementById('reminderList');
  if (!el) return;
  if (!_reminders.length) { el.innerHTML = '<div class="t-empty">No reminders yet.</div>'; return; }
  el.innerHTML = [..._reminders].reverse().map(r => `
    <div class="t-item${r.fired ? ' t-item-done' : ''}">
      <div style="flex:1">
        <div class="t-item-title">${_esc(r.text)}</div>
        <div class="t-item-sub">${r.dueAt ? '🕐 ' + new Date(r.dueAt).toLocaleString() : 'No due time'}${r.fired ? ' · ✅ Fired' : ''}</div>
      </div>
      <button class="t-btn t-btn-danger t-btn-sm" onclick="_deleteReminder('${r.id}')">✕</button>
    </div>`).join('');
}

async function _addReminder() {
  const textEl = document.getElementById('reminderText');
  const timeEl = document.getElementById('reminderTime');
  const text = textEl?.value?.trim();
  if (!text) return;
  await fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, dueAt: timeEl?.value || null }) });
  textEl.value = ''; if (timeEl) timeEl.value = '';
  _loadReminders();
  _logAudit('reminder_added', text.slice(0, 100));
}

async function _deleteReminder(id) {
  await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
  _reminders = _reminders.filter(r => r.id !== id);
  _displayReminders();
}

// Poll reminders every 60 seconds
setInterval(async () => {
  try {
    const r = await fetch('/api/reminders').then(x => x.json());
    const now = Date.now();
    for (const rem of (r.reminders || [])) {
      if (!rem.fired && rem.dueAt && new Date(rem.dueAt).getTime() <= now) {
        if (Notification.permission === 'granted') new Notification('JARVIS Reminder', { body: rem.text });
        if (typeof addMessage === 'function') addMessage('ai', `⏰ **Reminder:** ${rem.text}`);
        if (typeof speak === 'function') speak(`Reminder: ${rem.text}`);
        await fetch(`/api/reminders/${rem.id}/fired`, { method: 'PATCH' });
      }
    }
  } catch {}
}, 60000);

if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();

// ═══════════════════════════════════════════════
// 2. TASKS + POMODORO
// ═══════════════════════════════════════════════
function _renderTasks(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">✅ Tasks + Pomodoro</h3>
      <div class="t-pomo-box">
        <div class="t-pomo-dial">
          <div id="pomoTime" class="t-pomo-time">25:00</div>
          <div id="pomoMode" class="t-pomo-mode">WORK SESSION</div>
        </div>
        <div class="t-row" style="justify-content:center;gap:8px;margin-top:10px">
          <button id="pomoStartBtn" class="t-btn t-btn-primary" onclick="_pomoStartStop()">▶ Start</button>
          <button class="t-btn" onclick="_pomoReset()">↺ Reset</button>
          <button class="t-btn" onclick="_pomoSkip()">⏭ Skip</button>
        </div>
      </div>
      <div class="t-row" style="margin-top:14px">
        <input id="taskInput" class="t-input" placeholder="Add a task..." style="flex:1" onkeydown="if(event.key==='Enter')_addTask()"/>
        <button class="t-btn t-btn-primary" onclick="_addTask()">+ Add</button>
      </div>
      <div id="taskList" class="t-list" style="margin-top:8px"></div>
    </div>`;
  _loadTasks();
  _updatePomoDisplay();
}

function _loadTasks() {
  const saved = localStorage.getItem('jarvisTasks');
  _tasks = saved ? JSON.parse(saved) : [];
  _displayTasks();
}

function _saveTasks() { localStorage.setItem('jarvisTasks', JSON.stringify(_tasks)); }

function _displayTasks() {
  const el = document.getElementById('taskList');
  if (!el) return;
  if (!_tasks.length) { el.innerHTML = '<div class="t-empty">No tasks. Add one above.</div>'; return; }
  el.innerHTML = _tasks.map((t, i) => `
    <div class="t-item${t.done ? ' t-item-done' : ''}">
      <input type="checkbox" ${t.done ? 'checked' : ''} onchange="_toggleTask(${i})" style="margin-right:8px;accent-color:#00d4ff;cursor:pointer"/>
      <span style="flex:1;${t.done ? 'text-decoration:line-through;opacity:0.5' : ''}">${_esc(t.text)}</span>
      <button class="t-btn t-btn-danger t-btn-sm" onclick="_deleteTask(${i})">✕</button>
    </div>`).join('');
}

function _addTask() {
  const el = document.getElementById('taskInput');
  const text = el?.value?.trim();
  if (!text) return;
  _tasks.unshift({ text, done: false, createdAt: new Date().toISOString() });
  _saveTasks(); el.value = ''; _displayTasks();
}

function _toggleTask(i) { _tasks[i].done = !_tasks[i].done; _saveTasks(); _displayTasks(); }
function _deleteTask(i) { _tasks.splice(i, 1); _saveTasks(); _displayTasks(); }

function _pomoStartStop() {
  const btn = document.getElementById('pomoStartBtn');
  if (_pomodoroRunning) {
    clearInterval(_pomodoroTimer); _pomodoroRunning = false;
    if (btn) btn.textContent = '▶ Start';
  } else {
    _pomodoroRunning = true;
    if (btn) btn.textContent = '⏸ Pause';
    _pomodoroTimer = setInterval(() => {
      _pomodoroSecs--;
      if (_pomodoroSecs <= 0) {
        clearInterval(_pomodoroTimer); _pomodoroRunning = false;
        const wasWork = _pomodoroMode === 'work';
        _pomodoroMode = wasWork ? 'break' : 'work';
        _pomodoroSecs = wasWork ? 5 * 60 : 25 * 60;
        const msg = wasWork ? '✅ Pomodoro complete! Take a 5-minute break.' : '💪 Break over! Back to work.';
        if (Notification.permission === 'granted') new Notification('JARVIS', { body: msg });
        if (typeof speak === 'function') speak(msg);
        const b = document.getElementById('pomoStartBtn');
        if (b) b.textContent = '▶ Start';
      }
      _updatePomoDisplay();
    }, 1000);
  }
}

function _pomoReset() {
  clearInterval(_pomodoroTimer); _pomodoroRunning = false;
  _pomodoroMode = 'work'; _pomodoroSecs = 25 * 60;
  _updatePomoDisplay();
  const b = document.getElementById('pomoStartBtn'); if (b) b.textContent = '▶ Start';
}

function _pomoSkip() {
  clearInterval(_pomodoroTimer); _pomodoroRunning = false;
  _pomodoroMode = _pomodoroMode === 'work' ? 'break' : 'work';
  _pomodoroSecs = _pomodoroMode === 'work' ? 25 * 60 : 5 * 60;
  _updatePomoDisplay();
  const b = document.getElementById('pomoStartBtn'); if (b) b.textContent = '▶ Start';
}

function _updatePomoDisplay() {
  const m = Math.floor(_pomodoroSecs / 60).toString().padStart(2, '0');
  const s = (_pomodoroSecs % 60).toString().padStart(2, '0');
  const timeEl = document.getElementById('pomoTime');
  const modeEl = document.getElementById('pomoMode');
  if (timeEl) timeEl.textContent = `${m}:${s}`;
  if (modeEl) modeEl.textContent = _pomodoroMode === 'work' ? 'WORK SESSION' : '☕ BREAK TIME';
}

// ═══════════════════════════════════════════════
// 3. NOTES
// ═══════════════════════════════════════════════
function _renderNotes(body) {
  body.innerHTML = `
    <div class="t-section" style="height:100%;display:flex;flex-direction:column">
      <h3 class="t-title">📝 Notes</h3>
      <div class="t-row">
        <input id="noteSearch" class="t-input" placeholder="Search notes..." style="flex:1" oninput="_filterNotes(this.value)"/>
        <button class="t-btn t-btn-primary" onclick="_newNote()">+ New Note</button>
      </div>
      <div style="flex:1;overflow:hidden;margin-top:8px;display:flex;gap:8px;min-height:0">
        <div id="notesSidebar" class="t-list" style="width:200px;flex-shrink:0;overflow-y:auto;padding-right:4px">Loading...</div>
        <div id="noteEditor" style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0">
          <div class="t-empty" style="margin:auto">Select a note to edit</div>
        </div>
      </div>
    </div>`;
  _fetchNotes();
}

async function _fetchNotes() {
  try {
    const r = await fetch('/api/notes').then(x => x.json());
    _notesList = r.notes || [];
    _displayNotesSidebar();
  } catch { const el = document.getElementById('notesSidebar'); if (el) el.innerHTML = '<div class="t-err">Error loading notes</div>'; }
}

function _filterNotes(q) { _noteSearch = q.toLowerCase(); _displayNotesSidebar(); }

function _displayNotesSidebar() {
  const el = document.getElementById('notesSidebar');
  if (!el) return;
  const filtered = _notesList.filter(n => !_noteSearch || n.title.toLowerCase().includes(_noteSearch) || n.content.toLowerCase().includes(_noteSearch));
  if (!filtered.length) { el.innerHTML = '<div class="t-empty">No notes</div>'; return; }
  el.innerHTML = filtered.map(n => `
    <div class="t-note-item${_noteEditId === n.id ? ' active' : ''}" onclick="_editNote('${n.id}')">
      <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(n.title)}</div>
      <div style="font-size:10px;opacity:0.5;margin-top:2px">${new Date(n.updatedAt).toLocaleDateString()}</div>
    </div>`).join('');
}

function _newNote() { _noteEditId = null; _displayNotesSidebar(); _showNoteEditor({ id: null, title: '', content: '', tags: [] }); }

function _editNote(id) {
  const note = _notesList.find(n => n.id === id);
  if (!note) return;
  _noteEditId = id; _displayNotesSidebar(); _showNoteEditor(note);
}

function _showNoteEditor(note) {
  const editor = document.getElementById('noteEditor');
  if (!editor) return;
  editor.innerHTML = `
    <input id="noteTitle" class="t-input" placeholder="Note title..." value="${_esc(note.title)}"/>
    <input id="noteTags" class="t-input" placeholder="Tags (comma separated)" value="${_esc((note.tags||[]).join(', '))}"/>
    <textarea id="noteContent" class="t-textarea" placeholder="Write your note here..." style="flex:1;min-height:180px">${_esc(note.content)}</textarea>
    <div class="t-row">
      <button class="t-btn t-btn-primary" onclick="_saveNote(${note.id ? `'${note.id}'` : 'null'})">💾 Save</button>
      ${note.id ? `<button class="t-btn t-btn-danger" onclick="_deleteNote('${note.id}')">🗑 Delete</button>` : ''}
    </div>`;
}

async function _saveNote(id) {
  const title   = document.getElementById('noteTitle')?.value?.trim();
  const content = document.getElementById('noteContent')?.value || '';
  const tags    = (document.getElementById('noteTags')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!title) { alert('Title required'); return; }
  if (id) {
    await fetch(`/api/notes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content, tags }) });
  } else {
    await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content, tags }) });
  }
  _fetchNotes();
  _logAudit('note_saved', title.slice(0, 100));
}

async function _deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  _noteEditId = null;
  const editor = document.getElementById('noteEditor');
  if (editor) editor.innerHTML = '<div class="t-empty" style="margin:auto">Note deleted</div>';
  _fetchNotes();
}

// ═══════════════════════════════════════════════
// 4. PASSWORD VAULT (WebCrypto AES-256-GCM — passwords never sent to server)
// ═══════════════════════════════════════════════
function _renderVault(body) {
  if (_vaultKey) { _showVaultDashboard(body); return; }
  body.innerHTML = `
    <div class="t-section" style="text-align:center;max-width:340px;margin:auto">
      <h3 class="t-title">🔐 Password Vault</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:16px">AES-256-GCM encrypted · stored locally · never sent to server</p>
      <input id="vaultMaster" class="t-input" type="password" placeholder="Master password..." style="width:100%;margin-bottom:10px"/>
      <div class="t-row" style="justify-content:center;gap:8px">
        <button class="t-btn t-btn-primary" onclick="_vaultUnlock()">🔓 Unlock</button>
        <button class="t-btn" onclick="_vaultCreate()">✨ Create Vault</button>
      </div>
      <div id="vaultMsg" style="font-size:11px;margin-top:10px"></div>
    </div>`;
}

async function _vaultDeriveKey(password, salt) {
  const enc = new TextEncoder();
  const km  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function _vaultEncrypt(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { iv: _b64e(iv), ct: _b64e(new Uint8Array(ct)) };
}

async function _vaultDecrypt(key, iv64, ct64) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _b64d(iv64) }, key, _b64d(ct64));
  return JSON.parse(new TextDecoder().decode(pt));
}

function _b64e(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function _b64d(s)   { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function _vaultUnlock() {
  const password = document.getElementById('vaultMaster')?.value;
  if (!password) return;
  const stored = localStorage.getItem('jarvisVault');
  if (!stored) { _setVaultMsg('No vault found. Create one first.', '#ff5252'); return; }
  try {
    const { salt64, iv64, ct64 } = JSON.parse(stored);
    const key = await _vaultDeriveKey(password, _b64d(salt64));
    _vaultEntries = await _vaultDecrypt(key, iv64, ct64);
    _vaultKey = key;
    _showVaultDashboard(document.getElementById('toolsBody'));
  } catch { _setVaultMsg('❌ Wrong password or corrupted vault.', '#ff5252'); }
}

async function _vaultCreate() {
  const password = document.getElementById('vaultMaster')?.value;
  if (!password || password.length < 6) { alert('Master password must be at least 6 characters'); return; }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  _vaultKey = await _vaultDeriveKey(password, salt);
  _vaultEntries = [];
  const { iv: iv64, ct: ct64 } = await _vaultEncrypt(_vaultKey, _vaultEntries);
  localStorage.setItem('jarvisVault', JSON.stringify({ salt64: _b64e(salt), iv64, ct64 }));
  _showVaultDashboard(document.getElementById('toolsBody'));
}

function _setVaultMsg(text, color) {
  const el = document.getElementById('vaultMsg');
  if (el) { el.textContent = text; el.style.color = color || 'var(--accent)'; }
}

async function _vaultSave() {
  if (!_vaultKey) return;
  const stored = localStorage.getItem('jarvisVault');
  const salt64 = stored ? JSON.parse(stored).salt64 : _b64e(crypto.getRandomValues(new Uint8Array(16)));
  const { iv: iv64, ct: ct64 } = await _vaultEncrypt(_vaultKey, _vaultEntries);
  localStorage.setItem('jarvisVault', JSON.stringify({ salt64, iv64, ct64 }));
}

function _showVaultDashboard(body) {
  body.innerHTML = `
    <div class="t-section">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 class="t-title">🔐 Vault — ${_vaultEntries.length} entries</h3>
        <button class="t-btn t-btn-danger t-btn-sm" onclick="_vaultLock()">🔒 Lock</button>
      </div>
      <div class="t-row" style="margin-top:10px">
        <input id="vaultSite" class="t-input" placeholder="Site/App" style="flex:1"/>
        <input id="vaultUser" class="t-input" placeholder="Username" style="flex:1"/>
        <input id="vaultPass" class="t-input" type="password" placeholder="Password" style="flex:1"/>
        <button class="t-btn t-btn-primary" onclick="_vaultAddEntry()">+ Add</button>
      </div>
      <div id="vaultList" class="t-list" style="margin-top:8px"></div>
    </div>`;
  _displayVaultEntries();
}

function _displayVaultEntries() {
  const el = document.getElementById('vaultList');
  if (!el) return;
  if (!_vaultEntries.length) { el.innerHTML = '<div class="t-empty">No entries yet.</div>'; return; }
  el.innerHTML = _vaultEntries.map((e, i) => `
    <div class="t-item">
      <div style="flex:1">
        <div class="t-item-title">${_esc(e.site)}</div>
        <div class="t-item-sub">${_esc(e.user)}</div>
      </div>
      <button class="t-btn t-btn-sm" onclick="_vaultCopyPass(${i})" title="Copy password">📋</button>
      <button class="t-btn t-btn-danger t-btn-sm" onclick="_vaultDeleteEntry(${i})">✕</button>
    </div>`).join('');
}

async function _vaultAddEntry() {
  const site = document.getElementById('vaultSite')?.value?.trim();
  const user = document.getElementById('vaultUser')?.value?.trim();
  const pass = document.getElementById('vaultPass')?.value;
  if (!site || !user || !pass) { alert('All fields required'); return; }
  _vaultEntries.unshift({ site, user, pass, createdAt: new Date().toISOString() });
  await _vaultSave();
  ['vaultSite','vaultUser','vaultPass'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  _displayVaultEntries();
}

async function _vaultDeleteEntry(i) {
  if (!confirm('Delete this entry?')) return;
  _vaultEntries.splice(i, 1);
  await _vaultSave(); _displayVaultEntries();
}

function _vaultCopyPass(i) {
  navigator.clipboard.writeText(_vaultEntries[i].pass)
    .then(() => { if (typeof addMessage === 'function') addMessage('ai', '📋 Password copied to clipboard.'); });
}

function _vaultLock() { _vaultKey = null; _vaultEntries = []; _renderVault(document.getElementById('toolsBody')); }

// ═══════════════════════════════════════════════
// 5. CLIPBOARD HISTORY
// ═══════════════════════════════════════════════
function _renderClipboard(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">📋 Clipboard History</h3>
      <div class="t-row">
        <button class="t-btn t-btn-primary" onclick="_captureClipboard()">📋 Capture Clipboard</button>
        <button class="t-btn t-btn-danger" onclick="_clearClipboard()">🗑 Clear All</button>
      </div>
      <p style="font-size:10px;color:var(--text-muted);margin:6px 0">Click Capture after copying something. Browser clipboard permission required.</p>
      <div id="clipboardList" class="t-list" style="margin-top:4px"></div>
    </div>`;
  _displayClipboard();
}

async function _captureClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text && (!_clipboardHistory.length || _clipboardHistory[0].text !== text)) {
      _clipboardHistory.unshift({ text, timestamp: new Date().toLocaleTimeString() });
      if (_clipboardHistory.length > _MAX_CLIPBOARD) _clipboardHistory.pop();
      _displayClipboard();
    }
  } catch { alert('Clipboard access denied. Allow clipboard permission in browser settings.'); }
}

function _displayClipboard() {
  const el = document.getElementById('clipboardList');
  if (!el) return;
  if (!_clipboardHistory.length) { el.innerHTML = '<div class="t-empty">No clipboard history. Click Capture to read current clipboard.</div>'; return; }
  el.innerHTML = _clipboardHistory.map((item, i) => `
    <div class="t-item">
      <div style="flex:1;overflow:hidden;min-width:0">
        <div style="font-size:11px;font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(item.text)}</div>
        <div class="t-item-sub">${item.timestamp}</div>
      </div>
      <button class="t-btn t-btn-sm" onclick="navigator.clipboard.writeText(_clipboardHistory[${i}].text)" title="Copy back">📋</button>
      <button class="t-btn t-btn-danger t-btn-sm" onclick="_clipboardHistory.splice(${i},1);_displayClipboard()">✕</button>
    </div>`).join('');
}

function _clearClipboard() { _clipboardHistory = []; _displayClipboard(); }

// ═══════════════════════════════════════════════
// 6. PROCESS MONITOR
// ═══════════════════════════════════════════════
function _renderProcesses(body) {
  body.innerHTML = `
    <div class="t-section">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 class="t-title">🖥 Process Monitor</h3>
        <div class="t-row" style="gap:6px">
          <span id="procCount" class="t-item-sub"></span>
          <button class="t-btn t-btn-primary" onclick="_refreshProcesses()">↺ Refresh</button>
          <button id="procAutoBtn" class="t-btn" onclick="_toggleProcAuto()">▶ Auto</button>
        </div>
      </div>
      <input id="procFilter" class="t-input" placeholder="Filter by process name..." style="width:100%;margin:8px 0" oninput="_filterProcs(this.value)"/>
      <div id="procList" style="overflow-y:auto;flex:1;max-height:420px">Loading...</div>
    </div>`;
  _procFilter = '';
  _refreshProcesses();
}

async function _refreshProcesses() {
  try {
    const r = await fetch('/api/process-monitor').then(x => x.json());
    _procAllData = r.processes || [];
    const countEl = document.getElementById('procCount');
    if (countEl) countEl.textContent = `${_procAllData.length} processes`;
    _filterProcs(document.getElementById('procFilter')?.value || '');
  } catch { const el = document.getElementById('procList'); if (el) el.innerHTML = '<div class="t-err">Could not load processes</div>'; }
}

function _filterProcs(q) {
  _procFilter = q.toLowerCase();
  const el = document.getElementById('procList');
  if (!el) return;
  const filtered = _procAllData.filter(p => !_procFilter || p.name.toLowerCase().includes(_procFilter));
  if (!filtered.length) { el.innerHTML = '<div class="t-empty">No matching processes</div>'; return; }
  el.innerHTML = `<table class="t-table">
    <thead><tr><th>Name</th><th>PID</th><th>Memory</th><th></th></tr></thead>
    <tbody>${filtered.slice(0, 40).map(p => `
      <tr>
        <td>${_esc(p.name)}</td>
        <td style="font-family:var(--font-mono)">${p.pid}</td>
        <td style="font-family:var(--font-mono)">${(p.memKB / 1024).toFixed(0)} MB</td>
        <td><button class="t-btn t-btn-danger t-btn-sm" onclick="_killProcess('${p.pid}','${_esc(p.name).replace(/'/g,'&apos;')}')">Kill</button></td>
      </tr>`).join('')}</tbody>
  </table>`;
}

async function _killProcess(pid, name) {
  if (!confirm(`Kill ${name} (PID: ${pid})?`)) return;
  const r = await fetch('/api/process-monitor/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) }).then(x => x.json());
  if (r.success) { _logAudit('process_killed', `${name} PID:${pid}`); _refreshProcesses(); }
  else alert('Failed: ' + r.error);
}

function _toggleProcAuto() {
  const btn = document.getElementById('procAutoBtn');
  if (_procAutoActive) {
    clearInterval(_procPollInterval); _procPollInterval = null; _procAutoActive = false;
    if (btn) btn.textContent = '▶ Auto';
  } else {
    _procAutoActive = true;
    if (btn) btn.textContent = '⏸ Auto ON';
    _procPollInterval = setInterval(_refreshProcesses, 3000);
  }
}

// ═══════════════════════════════════════════════
// 7. NETWORK MONITOR
// ═══════════════════════════════════════════════
function _renderNetwork(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">🌐 Network Monitor</h3>
      <button class="t-btn t-btn-primary" onclick="_checkNetwork()">🔍 Check Now</button>
      <div id="networkResult" style="margin-top:12px"></div>
    </div>`;
  _checkNetwork();
}

async function _checkNetwork() {
  const el = document.getElementById('networkResult');
  if (el) el.innerHTML = '<div class="t-empty">Pinging 8.8.8.8...</div>';
  try {
    const r = await fetch('/api/network-info').then(x => x.json());
    const sc = r.online ? '#00c853' : '#ff5252';
    let html = `<div class="t-item" style="border-color:${sc}30;background:${sc}0d">
      <div>
        <div class="t-item-title" style="color:${sc}">${r.online ? '🟢 ONLINE' : '🔴 OFFLINE'}</div>
        <div class="t-item-sub">Ping 8.8.8.8: ${r.pingMs != null ? r.pingMs + 'ms' : 'N/A'}</div>
      </div>
    </div>`;
    (r.interfaces || []).forEach(iface => iface.addresses.forEach(addr => {
      html += `<div class="t-item">
        <div>
          <div class="t-item-title">${_esc(iface.name)} <span style="color:var(--text-muted);font-size:10px">${addr.family}</span></div>
          <div class="t-item-sub" style="font-family:var(--font-mono)">${addr.address}</div>
        </div>
      </div>`;
    }));
    if (el) el.innerHTML = html;
  } catch { if (el) el.innerHTML = '<div class="t-err">Network check failed</div>'; }
}

// ═══════════════════════════════════════════════
// 8. WINDOW MANAGER
// ═══════════════════════════════════════════════
function _renderWindows(body) {
  body.innerHTML = `
    <div class="t-section">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 class="t-title">🪟 Window Manager</h3>
        <button class="t-btn t-btn-primary" onclick="_loadWindows()">↺ Refresh</button>
      </div>
      <div id="windowsList" class="t-list" style="margin-top:8px">Loading...</div>
    </div>`;
  _loadWindows();
}

async function _loadWindows() {
  const el = document.getElementById('windowsList');
  try {
    const r = await fetch('/api/windows').then(x => x.json());
    if (!r.windows?.length) { if (el) el.innerHTML = '<div class="t-empty">No windows found</div>'; return; }
    if (el) el.innerHTML = r.windows.map(w => `
      <div class="t-item">
        <div style="flex:1;overflow:hidden;min-width:0">
          <div class="t-item-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(w.MainWindowTitle || w.ProcessName)}</div>
          <div class="t-item-sub">${_esc(w.ProcessName)} · PID ${w.Id}</div>
        </div>
        <button class="t-btn t-btn-sm" onclick="_windowAction(${w.Id},'focus')">Focus</button>
        <button class="t-btn t-btn-danger t-btn-sm" onclick="_windowAction(${w.Id},'close')">Close</button>
      </div>`).join('');
  } catch { if (el) el.innerHTML = '<div class="t-err">Could not list windows</div>'; }
}

async function _windowAction(pid, action) {
  const r = await fetch('/api/windows/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid, action }) }).then(x => x.json());
  if (r.success && action !== 'focus') _loadWindows();
  else if (!r.success) alert('Failed: ' + r.error);
}

// ═══════════════════════════════════════════════
// 9. GIT INTEGRATION
// ═══════════════════════════════════════════════
function _renderGit(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">🔧 Git Integration</h3>
      <input id="gitCwd" class="t-input" placeholder="Repo path (e.g. D:\\my-project)" style="width:100%;margin-bottom:8px" value="${_esc(localStorage.getItem('jarvisGitCwd') || '')}"/>
      <div class="t-row">
        <select id="gitCmd" class="t-input" style="width:140px">
          <option>status</option><option>log</option><option>diff</option>
          <option>branch</option><option>pull</option><option>push</option>
          <option>fetch</option><option>stash</option><option>add</option>
          <option>commit</option><option>checkout</option><option>reset</option>
          <option>remote</option><option>show</option>
        </select>
        <input id="gitArgs" class="t-input" placeholder='args (e.g. --oneline -10)' style="flex:1"/>
        <button class="t-btn t-btn-primary" onclick="_runGit()">▶ Run</button>
      </div>
      <div class="t-row" style="margin-top:6px;gap:4px;flex-wrap:wrap">
        ${['status','log --oneline -10','diff','branch -a','pull','remote -v'].map(c =>
          `<button class="t-btn t-btn-sm" onclick="_quickGit('${c}')">${c}</button>`).join('')}
      </div>
      <pre id="gitOutput" class="t-output" style="margin-top:8px;min-height:100px">Output will appear here</pre>
    </div>`;
}

function _quickGit(cmd) {
  const parts = cmd.split(' ');
  const sel = document.getElementById('gitCmd'); if (sel) sel.value = parts[0];
  const args = document.getElementById('gitArgs'); if (args) args.value = parts.slice(1).join(' ');
  _runGit();
}

async function _runGit() {
  const cwd = document.getElementById('gitCwd')?.value?.trim() || '';
  const sub = document.getElementById('gitCmd')?.value || 'status';
  const args = document.getElementById('gitArgs')?.value?.trim() || '';
  localStorage.setItem('jarvisGitCwd', cwd);
  const out = document.getElementById('gitOutput');
  if (out) out.textContent = 'Running...';
  const r = await fetch('/api/git', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, subcommand: sub, args }) }).then(x => x.json());
  if (out) out.textContent = r.output || r.error || '(no output)';
  _logAudit('git_command', `git ${sub} ${args}`);
}

// ═══════════════════════════════════════════════
// 10. CODE RUNNER
// ═══════════════════════════════════════════════
function _renderCodeRunner(body) {
  body.innerHTML = `
    <div class="t-section" style="display:flex;flex-direction:column;height:100%">
      <h3 class="t-title">💻 Code Runner</h3>
      <div class="t-row">
        <select id="codeRunLang" class="t-input" style="width:150px">
          <option value="javascript">JavaScript (Node)</option>
          <option value="python">Python</option>
        </select>
        <button class="t-btn t-btn-primary" onclick="_runCode()">▶ Run</button>
        <button class="t-btn" onclick="_clearCode()">Clear</button>
      </div>
      <textarea id="codeRunInput" class="t-textarea" placeholder="// Enter code here..." style="flex:1;margin-top:8px;font-family:var(--font-mono);font-size:12px;min-height:180px"></textarea>
      <div style="font-size:10px;color:var(--text-muted);margin:4px 0">Output:</div>
      <pre id="codeRunOutput" class="t-output" style="min-height:80px;max-height:200px;overflow-y:auto">Ready.</pre>
    </div>`;
}

async function _runCode() {
  const code = document.getElementById('codeRunInput')?.value;
  const lang = document.getElementById('codeRunLang')?.value;
  const out  = document.getElementById('codeRunOutput');
  if (!code?.trim()) return;
  if (out) out.textContent = 'Running...';
  const r = await fetch('/api/run-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, language: lang }) }).then(x => x.json());
  if (out) out.textContent = r.success ? (r.output || '(no output)') : '❌ ' + (r.error || 'Error');
  _logAudit('code_run', lang);
}

function _clearCode() {
  const el = document.getElementById('codeRunInput'); if (el) el.value = '';
  const out = document.getElementById('codeRunOutput'); if (out) out.textContent = 'Ready.';
}

// ═══════════════════════════════════════════════
// 11. NEWS FEED
// ═══════════════════════════════════════════════
function _renderNews(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">📰 News Feed (BBC)</h3>
      <div class="t-row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${['tech','world','science','business','hn'].map(c =>
          `<button class="t-btn t-btn-sm news-cat-btn" data-cat="${c}" onclick="_loadNews('${c}')">${c.toUpperCase()}</button>`).join('')}
      </div>
      <div id="newsList" class="t-list">Loading...</div>
    </div>`;
  _loadNews('tech');
}

async function _loadNews(category) {
  const el = document.getElementById('newsList');
  document.querySelectorAll('.news-cat-btn').forEach(b => b.classList.toggle('t-btn-primary', b.dataset.cat === category));
  if (el) el.innerHTML = '<div class="t-empty">Fetching news...</div>';
  try {
    const r = await fetch(`/api/news?category=${category}`).then(x => x.json());
    if (!r.items?.length) { if (el) el.innerHTML = '<div class="t-err">No news items found</div>'; return; }
    if (el) el.innerHTML = r.items.map(item => `
      <div class="t-item" style="flex-direction:column;align-items:flex-start">
        <a href="${_esc(item.link)}" target="_blank" rel="noopener" class="t-item-title" style="color:var(--accent);text-decoration:none;font-size:12px">${_esc(item.title)}</a>
        ${item.desc ? `<div class="t-item-sub" style="margin-top:4px;line-height:1.4">${_esc(item.desc)}</div>` : ''}
        <div class="t-item-sub" style="margin-top:2px">${item.pubDate ? new Date(item.pubDate).toLocaleDateString() : ''}</div>
      </div>`).join('');
  } catch { if (el) el.innerHTML = '<div class="t-err">Failed to fetch news</div>'; }
}

// ═══════════════════════════════════════════════
// 12. BREACH CHECK
// ═══════════════════════════════════════════════
function _renderBreach(body) {
  body.innerHTML = `
    <div class="t-section" style="max-width:420px">
      <h3 class="t-title">🛡 Password Breach Check</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:14px">
        Uses <strong>HaveIBeenPwned k-Anonymity API</strong>. Only the first 5 characters of the SHA-1 hash are sent — your password is never exposed.
      </p>
      <input id="breachInput" class="t-input" type="password" placeholder="Enter password to check..." style="width:100%;margin-bottom:8px"/>
      <button class="t-btn t-btn-primary" onclick="_checkBreach()" style="width:100%">🔍 Check Password</button>
      <div id="breachResult" style="margin-top:16px"></div>
    </div>`;
}

async function _checkBreach() {
  const pw = document.getElementById('breachInput')?.value;
  if (!pw) return;
  const el = document.getElementById('breachResult');
  if (el) el.innerHTML = '<div class="t-empty">Checking...</div>';
  const r = await fetch('/api/breach-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }).then(x => x.json());
  const pwInput = document.getElementById('breachInput');
  if (pwInput) pwInput.value = '';
  if (!r.success) { if (el) el.innerHTML = `<div class="t-err">Error: ${_esc(r.error)}</div>`; return; }
  const color = r.pwned ? '#ff5252' : '#00c853';
  const icon  = r.pwned ? '⚠️' : '✅';
  const msg   = r.pwned
    ? `This password has been seen <strong>${r.count.toLocaleString()}</strong> times in data breaches. Do NOT use it.`
    : 'This password was not found in any known data breaches. Looks safe!';
  if (el) el.innerHTML = `<div class="t-item" style="border-color:${color}40;background:${color}10">
    <div>
      <div class="t-item-title" style="color:${color}">${icon} ${r.pwned ? 'COMPROMISED' : 'SAFE'}</div>
      <div class="t-item-sub" style="margin-top:4px">${msg}</div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════
// 13. AUDIO TRANSCRIPTION (Groq Whisper)
// ═══════════════════════════════════════════════
function _renderTranscribe(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">🎙 Audio Transcription (Groq Whisper)</h3>
      <div class="t-row" style="gap:8px">
        <button id="transcribeBtn" class="t-btn t-btn-primary" onclick="_toggleTranscribeRecord()">🎙 Start Recording</button>
        <span id="transcribeStatus" class="t-item-sub"></span>
      </div>
      <div style="margin:10px 0;font-size:11px;color:var(--text-muted)">— or upload an audio file —</div>
      <input type="file" id="transcribeFile" accept="audio/*" class="t-input" style="width:100%"/>
      <button class="t-btn t-btn-primary" onclick="_transcribeFile()" style="margin-top:6px">📤 Transcribe File</button>
      <div style="margin-top:14px">
        <div class="t-item-title" style="margin-bottom:4px">Transcript:</div>
        <textarea id="transcribeOutput" class="t-textarea" style="min-height:120px" readonly placeholder="Transcript will appear here..."></textarea>
        <div class="t-row" style="margin-top:6px;gap:6px">
          <button class="t-btn t-btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('transcribeOutput').value)">📋 Copy</button>
          <button class="t-btn t-btn-sm" onclick="if(typeof addMessage==='function'&&document.getElementById('transcribeOutput').value)addMessage('user',document.getElementById('transcribeOutput').value)">💬 Send to Chat</button>
        </div>
      </div>
    </div>`;
}

async function _toggleTranscribeRecord() {
  const btn    = document.getElementById('transcribeBtn');
  const status = document.getElementById('transcribeStatus');
  if (!_transcribeRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _transcribeRecorder = new MediaRecorder(stream);
      _transcribeChunks   = [];
      _transcribeRecorder.ondataavailable = e => { if (e.data.size > 0) _transcribeChunks.push(e.data); };
      _transcribeRecorder.onstop = _sendTranscribeAudio;
      _transcribeRecorder.start(1000);
      _transcribeRecording = true;
      if (btn) btn.textContent = '⏹ Stop Recording';
      if (status) { status.textContent = '🔴 Recording...'; status.style.color = '#ff5252'; }
    } catch { alert('Microphone access denied'); }
  } else {
    _transcribeRecorder?.stop();
    _transcribeRecorder?.stream?.getTracks().forEach(t => t.stop());
    _transcribeRecording = false;
    if (btn) btn.textContent = '🎙 Start Recording';
    if (status) { status.textContent = 'Processing...'; status.style.color = 'var(--accent)'; }
  }
}

async function _sendTranscribeAudio() {
  const form = new FormData();
  form.append('audio', new Blob(_transcribeChunks, { type: 'audio/webm' }), 'recording.webm');
  const status = document.getElementById('transcribeStatus');
  if (status) status.textContent = 'Transcribing...';
  const r = await fetch('/api/transcribe', { method: 'POST', body: form }).then(x => x.json());
  const out = document.getElementById('transcribeOutput');
  if (out) out.value = r.success ? r.transcript : '❌ ' + (r.error || 'Transcription failed');
  if (status) status.textContent = r.success ? '✅ Done' : '❌ Error';
}

async function _transcribeFile() {
  const fileEl = document.getElementById('transcribeFile');
  if (!fileEl?.files?.length) { alert('Select an audio file first'); return; }
  const status = document.getElementById('transcribeStatus');
  if (status) status.textContent = 'Uploading...';
  const form = new FormData();
  form.append('audio', fileEl.files[0]);
  const r = await fetch('/api/transcribe', { method: 'POST', body: form }).then(x => x.json());
  const out = document.getElementById('transcribeOutput');
  if (out) out.value = r.success ? r.transcript : '❌ ' + (r.error || 'Transcription failed');
  if (status) status.textContent = r.success ? '✅ Done' : '❌ Error';
}

// ═══════════════════════════════════════════════
// 14. VISION AI (Gemini)
// ═══════════════════════════════════════════════
function _renderVision(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">👁 Vision AI (Gemini)</h3>
      <div class="t-row" style="gap:8px;margin-bottom:8px">
        <button class="t-btn t-btn-primary" onclick="_visionScreenshot()">📸 Capture Screen</button>
        <span style="font-size:11px;color:var(--text-muted);align-self:center">or upload:</span>
        <input type="file" id="visionFile" accept="image/*" class="t-input" style="flex:1"/>
      </div>
      <div id="visionPreview" style="margin-bottom:8px;min-height:0"></div>
      <input id="visionQuestion" class="t-input" placeholder="What do you want to know about this image?" style="width:100%;margin-bottom:8px"/>
      <button class="t-btn t-btn-primary" onclick="_analyzeVision()" style="width:100%">🔍 Analyze Image</button>
      <div id="visionAnswer" style="margin-top:12px"></div>
    </div>`;
  document.getElementById('visionFile').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const preview = document.getElementById('visionPreview');
    if (preview) preview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--border-subtle)"/>`;
  });
}

async function _visionScreenshot() {
  try {
    const stream  = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track   = stream.getVideoTracks()[0];
    const capture = new ImageCapture(track);
    const bitmap  = await capture.grabFrame();
    track.stop();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const preview = document.getElementById('visionPreview');
      if (preview) { preview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--border-subtle)"/>`; preview._blob = blob; }
    }, 'image/jpeg', 0.85);
  } catch (e) { alert('Screen capture failed: ' + e.message); }
}

async function _analyzeVision() {
  const question = document.getElementById('visionQuestion')?.value?.trim() || 'Describe what you see in detail';
  const preview  = document.getElementById('visionPreview');
  const answerEl = document.getElementById('visionAnswer');
  let imageBlob  = preview?._blob;
  const fileEl   = document.getElementById('visionFile');
  if (!imageBlob && fileEl?.files?.length) imageBlob = fileEl.files[0];
  if (!imageBlob) { alert('Provide an image (capture screen or upload)'); return; }
  if (answerEl) answerEl.innerHTML = '<div class="t-empty">Analyzing image...</div>';
  const form = new FormData();
  form.append('image', imageBlob, 'image.jpg');
  form.append('question', question);
  const r = await fetch('/api/vision', { method: 'POST', body: form }).then(x => x.json());
  if (answerEl) {
    answerEl.innerHTML = r.success
      ? `<div class="t-item" style="flex-direction:column;font-size:12px;line-height:1.7">${_esc(r.answer).replace(/\n/g, '<br>')}</div>`
      : `<div class="t-err">❌ ${_esc(r.error)}</div>`;
  }
  if (r.success && typeof addMessage === 'function') addMessage('ai', `👁 **Vision Analysis:**\n\n${r.answer}`);
}

// ═══════════════════════════════════════════════
// 15. IMAGE GENERATION (Pollinations.ai — free)
// ═══════════════════════════════════════════════
function _renderImageGen(body) {
  body.innerHTML = `
    <div class="t-section">
      <h3 class="t-title">🖼 Image Generation</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Powered by <strong>Pollinations.ai</strong> — free, no API key needed</p>
      <textarea id="imgGenPrompt" class="t-textarea" placeholder="Describe the image in detail..." style="height:80px"></textarea>
      <button class="t-btn t-btn-primary" onclick="_generateImage()" style="width:100%;margin-top:8px">🎨 Generate Image</button>
      <div id="imgGenResult" style="margin-top:14px;text-align:center"></div>
    </div>`;
}

async function _generateImage() {
  const prompt = document.getElementById('imgGenPrompt')?.value?.trim();
  if (!prompt) return;
  const el = document.getElementById('imgGenResult');
  if (el) el.innerHTML = '<div class="t-empty">Generating image... (may take 10-20 seconds)</div>';
  const r = await fetch('/api/image-gen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) }).then(x => x.json());
  if (!r.success) { if (el) el.innerHTML = `<div class="t-err">${_esc(r.error)}</div>`; return; }
  if (el) el.innerHTML = `
    <img src="${r.imageUrl}" alt="Generated image" style="max-width:100%;border-radius:8px;border:1px solid var(--border-subtle)"
         onerror="this.parentElement.innerHTML='<div class=\\'t-err\\'>Image generation failed or timed out. Try again.</div>'"
         onload="this.style.display='block'"/>
    <div class="t-row" style="margin-top:8px;justify-content:center">
      <a href="${r.imageUrl}" download="jarvis-generated.jpg" target="_blank" class="t-btn t-btn-sm">📥 Download</a>
    </div>`;
  _logAudit('image_generated', prompt.slice(0, 100));
}

// ═══════════════════════════════════════════════
// 16. SCREEN RECORDER
// ═══════════════════════════════════════════════
function _renderRecorder(body) {
  body.innerHTML = `
    <div class="t-section" style="text-align:center;max-width:420px;margin:auto">
      <h3 class="t-title">📹 Screen Recorder</h3>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:20px">Records screen/window using browser MediaRecorder API. Saved locally as .webm</p>
      <button id="recBtn" class="t-btn t-btn-primary" onclick="_toggleRecording()" style="font-size:14px;padding:12px 28px">📹 Start Recording</button>
      <div id="recStatus" style="margin-top:14px;font-size:12px;color:var(--text-muted)"></div>
      <div id="recDownload" style="margin-top:14px"></div>
    </div>`;
}

async function _toggleRecording() {
  const btn    = document.getElementById('recBtn');
  const status = document.getElementById('recStatus');
  if (!_recordingActive) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      _recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      _mediaRecorder = new MediaRecorder(stream, { mimeType });
      _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _recordedChunks.push(e.data); };
      _mediaRecorder.onstop = _finishRecording;
      stream.getVideoTracks()[0].onended = () => { if (_recordingActive) _toggleRecording(); };
      _mediaRecorder.start(1000);
      _recordingActive = true;
      if (btn) { btn.textContent = '⏹ Stop Recording'; btn.style.background = 'rgba(255,82,82,0.15)'; btn.style.borderColor = '#ff5252'; btn.style.color = '#ff5252'; }
      if (status) status.textContent = '🔴 Recording in progress...';
    } catch (e) { alert('Screen capture failed: ' + e.message); }
  } else {
    _mediaRecorder?.stop();
    _mediaRecorder?.stream?.getTracks().forEach(t => t.stop());
    _recordingActive = false;
    if (btn) { btn.textContent = '📹 Start Recording'; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }
    if (status) status.textContent = 'Processing...';
  }
}

function _finishRecording() {
  const blob = new Blob(_recordedChunks, { type: 'video/webm' });
  const url  = URL.createObjectURL(blob);
  const size = (blob.size / 1024 / 1024).toFixed(1);
  const dl   = document.getElementById('recDownload');
  const status = document.getElementById('recStatus');
  if (status) status.textContent = `✅ Recording complete (${size} MB)`;
  if (dl) dl.innerHTML = `
    <a href="${url}" download="jarvis-recording-${Date.now()}.webm" class="t-btn t-btn-primary">📥 Download (${size} MB)</a>
    <video src="${url}" controls style="width:100%;margin-top:10px;border-radius:6px;border:1px solid var(--border-subtle)"></video>`;
  _logAudit('screen_recorded', `${size} MB`);
}

// ═══════════════════════════════════════════════
// 17. AUDIT LOG
// ═══════════════════════════════════════════════
function _renderAuditLog(body) {
  body.innerHTML = `
    <div class="t-section">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 class="t-title">📜 Session Audit Log</h3>
        <button class="t-btn t-btn-primary t-btn-sm" onclick="_loadAuditLog()">↺ Refresh</button>
      </div>
      <div id="auditList" class="t-list" style="margin-top:8px;max-height:450px;overflow-y:auto">Loading...</div>
    </div>`;
  _loadAuditLog();
}

async function _loadAuditLog() {
  const el = document.getElementById('auditList');
  try {
    const r   = await fetch('/api/audit-log').then(x => x.json());
    const log = (r.log || []).slice().reverse();
    if (!log.length) { if (el) el.innerHTML = '<div class="t-empty">No audit log entries yet.</div>'; return; }
    if (el) el.innerHTML = `<table class="t-table">
      <thead><tr><th>Time</th><th>Action</th><th>Detail</th></tr></thead>
      <tbody>${log.map(e => `
        <tr>
          <td style="white-space:nowrap;font-size:10px;opacity:0.7">${new Date(e.timestamp).toLocaleTimeString()}</td>
          <td style="color:var(--accent);font-size:11px">${_esc(e.action)}</td>
          <td style="font-size:10px;color:var(--text-muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(e.detail)}">${_esc(e.detail)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  } catch { if (el) el.innerHTML = '<div class="t-err">Could not load audit log</div>'; }
}

// Auto-log chat messages
function _hookAuditLog() {
  const origSend = window.sendMessage;
  if (typeof origSend === 'function') {
    window.sendMessage = async function(...args) {
      const msg = document.getElementById('userInput')?.value?.trim();
      if (msg) _logAudit('chat_message', msg.slice(0, 200));
      return origSend.apply(this, args);
    };
  }
}

function _logAudit(action, detail) {
  fetch('/api/audit-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, detail: detail || '' }) }).catch(() => {});
}

// ═══════════════════════════════════════════════
// 18. TELEGRAM BOT
// ═══════════════════════════════════════════════
function _renderTelegram(body) {
  body.innerHTML = `
    <div class="t-section" style="max-width:480px">
      <h3 class="t-title">🤖 Telegram Bot</h3>
      <div id="telegramStatus" class="t-empty">Checking status...</div>
      <div style="margin-top:18px">
        <h4 style="font-size:12px;color:var(--accent);margin-bottom:8px">Setup Instructions:</h4>
        <ol style="font-size:11px;color:var(--text-muted);line-height:2;margin:0;padding-left:18px">
          <li>Message <strong>@BotFather</strong> on Telegram → type <code>/newbot</code></li>
          <li>Add <code>TELEGRAM_BOT_TOKEN=your_token</code> to <code>.env</code></li>
          <li>Message <strong>@userinfobot</strong> to get your Chat ID</li>
          <li>Add <code>TELEGRAM_ALLOWED_CHAT_IDS=your_chat_id</code> to <code>.env</code></li>
          <li>Use <strong>ngrok</strong> or similar to expose localhost, then set webhook:<br>
            <code style="font-size:10px">https://api.telegram.org/bot&lt;TOKEN&gt;/setWebhook?url=https://your-ngrok.io/api/telegram/webhook</code>
          </li>
          <li>Restart the server</li>
        </ol>
        <div style="margin-top:14px">
          <h4 style="font-size:12px;color:var(--accent);margin-bottom:6px">Supported commands from Telegram:</h4>
          <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);line-height:2;background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:6px">
            help · system info · list apps<br>
            open &lt;app/site&gt; · run &lt;powershell command&gt;<br>
            confirm &lt;id&gt; · cancel &lt;id&gt;
          </div>
        </div>
        <div style="margin-top:14px">
          <h4 style="font-size:12px;color:var(--accent);margin-bottom:8px">Send test message:</h4>
          <div class="t-row">
            <input id="tgChatId" class="t-input" placeholder="Chat ID" style="width:130px"/>
            <input id="tgMsg" class="t-input" placeholder="Test message..." style="flex:1"/>
            <button class="t-btn t-btn-primary" onclick="_sendTelegramTest()">Send</button>
          </div>
          <div id="tgSendResult" style="font-size:11px;margin-top:6px"></div>
        </div>
      </div>
    </div>`;
  _checkTelegramStatus();
}

async function _checkTelegramStatus() {
  const el = document.getElementById('telegramStatus');
  try {
    const r = await fetch('/api/telegram/status').then(x => x.json());
    if (el) el.innerHTML = r.configured
      ? `<div class="t-item" style="border-color:#00c85330;background:#00c8530d"><div><div class="t-item-title" style="color:#00c853">✅ Bot Configured</div><div class="t-item-sub">Allowed chat IDs: ${r.allowedCount}</div></div></div>`
      : `<div class="t-item" style="border-color:#ff525230;background:#ff52520d"><div><div class="t-item-title" style="color:#ff5252">⚠️ Not Configured</div><div class="t-item-sub">Add TELEGRAM_BOT_TOKEN to .env and restart server</div></div></div>`;
  } catch {}
}

async function _sendTelegramTest() {
  const chatId = document.getElementById('tgChatId')?.value?.trim();
  const msg    = document.getElementById('tgMsg')?.value?.trim();
  if (!chatId || !msg) { alert('Chat ID and message required'); return; }
  const r  = await fetch('/api/telegram/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, text: msg }) }).then(x => x.json());
  const el = document.getElementById('tgSendResult');
  if (el) { el.textContent = r.success ? '✅ Message sent!' : '❌ ' + (r.error || 'Failed'); el.style.color = r.success ? '#00c853' : '#ff5252'; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS COMMAND HANDLER — fully chat-native, voice + text controlled
// Every action executes directly and responds in chat.
// No panel interaction needed — JARVIS performs everything from your instruction.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── News detection helpers (also used by chat.js for AI context) ─────────────
function _detectNewsQuery(text) {
  const t = text.toLowerCase();
  return /\b(latest|today.?s|current|breaking|recent|morning|evening)\s+(news|headlines?|events?|stories?|updates?)\b/i.test(t)
    || /\b(news|headlines?)\s+(today|now|latest|current|this\s+week)\b/i.test(t)
    || /\bwhat.?s\s+(happening|going\s+on|in\s+the\s+news|new\s+today)\b/i.test(t)
    || /\b(show|tell|give|read)\s+(me\s+)?(the\s+)?(news|headlines?|top\s+stories?)\b/i.test(t)
    || /\b(tech|technology|science|world|business|hacker)\s+news\b/i.test(t)
    || /\bnews\s+(feed|update|flash|brief|summary)\b/i.test(t)
    || /\bhacker\s+news\b/i.test(t)
    || /\bwhat.{0,10}(top|latest|recent)\b.*(news|stories?|headlines?)\b/i.test(t)
    || /\bmorning\s+brief\b/i.test(t);
}

function _detectNewsCategory(text) {
  const t = text.toLowerCase();
  if (/\bhacker\s+news\b|\bhn\b/i.test(t)) return 'hn';
  if (/\btech(nology)?\b|\bsoftware\b|\bai\b|\bartificial\s+intelligence\b/i.test(t)) return 'tech';
  if (/\bscience\b|\bspace\b|\benviron/i.test(t)) return 'science';
  if (/\bbusiness\b|\bfinance\b|\beconomy\b|\bmarket\b|\bstock\b/i.test(t)) return 'business';
  if (/\bworld\b|\bglobal\b|\binternational\b|\bpolitics\b/i.test(t)) return 'world';
  return 'tech';
}

// Fetch news as formatted text for AI context injection (called from chat.js)
async function fetchNewsForAIContext(text) {
  const cat = _detectNewsCategory(text);
  try {
    const r = await fetch(`/api/news?category=${cat}`).then(x => x.json());
    if (!r.items?.length) return null;
    const headlines = r.items.slice(0, 10).map((item, i) =>
      `${i+1}. ${item.title}${item.desc ? ' — ' + item.desc.slice(0, 120) : ''}`
    ).join('\n');
    return `LIVE NEWS FEED (${cat.toUpperCase()} — fetched right now from BBC/HN):\n${headlines}\n\nUse these current headlines to answer the user's question accurately.`;
  } catch { return null; }
}

// ─── News: direct chat handler ────────────────────────────────────────────────
async function _chatNews(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  const cat  = _detectNewsCategory(text);
  const catLabels = { tech:'🖥 Technology', world:'🌍 World', science:'🔬 Science', business:'💼 Business', hn:'🔥 Hacker News' };
  addMessage('user', text);
  setStatus('📰 FETCHING NEWS...');
  try {
    const r = await fetch(`/api/news?category=${cat}`).then(x => x.json());
    setStatus('✓ SYSTEM ONLINE');
    if (!r.items?.length) { addMessage('ai', `📰 No news found right now${boss}. Feed may be temporarily unavailable.`); return; }
    const headlines = r.items.slice(0, 8).map((item, i) =>
      `**${i+1}. ${item.title}**${item.desc ? '\n   ' + item.desc.slice(0, 130) : ''}`
    ).join('\n\n');
    addMessage('ai', `📰 **${catLabels[cat]} — Latest Headlines${boss}:**\n\n${headlines}\n\n_Say **"world news"**, **"tech news"**, **"science news"**, **"business news"**, or **"hacker news"** for different categories._`);
    speak(`Here are the latest ${cat === 'hn' ? 'hacker news' : cat} headlines${boss}.`);
  } catch {
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `📰 Could not fetch news${boss}. Check your internet connection.`);
  }
}

// ─── Reminders ────────────────────────────────────────────────────────────────
async function _chatAddReminder(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  let reminderText = text
    .replace(/\b(add\s+(a\s+)?reminder|set\s+(a\s+)?reminder|remind\s+(me|us)\s*(to|about)?|create\s+(a\s+)?reminder)\b/i, '')
    .replace(/^(to|about|for)\s+/i, '').trim();
  const timeMatch = reminderText.match(/\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i);
  let dueAt = null;
  if (timeMatch) {
    reminderText = reminderText.slice(0, -timeMatch[0].length).trim();
    try { dueAt = new Date(timeMatch[1]).toISOString(); } catch {}
  }
  if (!reminderText || reminderText.length < 2) {
    addMessage('ai', `⏰ What should I remind you about${boss}? Say: _"remind me to call John at 5pm"_`); return;
  }
  const r = await fetch('/api/reminders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: reminderText, dueAt }) }).then(x => x.json());
  if (r.success) {
    addMessage('ai', `⏰ Reminder set${boss}: **"${reminderText}"**${dueAt ? ` · Due: ${new Date(dueAt).toLocaleTimeString()}` : ''} ✅`);
    speak(`Reminder set${boss}: ${reminderText}`);
    _logAudit('reminder_added', reminderText.slice(0, 100));
  } else { addMessage('ai', `⚠️ Could not save reminder: ${r.error}`); }
}

async function _chatListReminders() {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', 'show my reminders');
  const r = await fetch('/api/reminders').then(x => x.json());
  const active = (r.reminders || []).filter(x => !x.fired);
  if (!active.length) { addMessage('ai', `⏰ No active reminders${boss}. Say _"remind me to..."_ to add one.`); return; }
  const list = active.map(rem => `- **${rem.text}**${rem.dueAt ? ' · ' + new Date(rem.dueAt).toLocaleString() : ''}`).join('\n');
  addMessage('ai', `⏰ **Your Reminders${boss}** (${active.length} active):\n\n${list}`);
  speak(`You have ${active.length} reminder${active.length>1?'s':''}${boss}.`);
}

async function _chatDeleteReminder(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const query = text.replace(/\b(delete|remove|cancel|clear)\s+(reminder|alarm)\s*(for|about|to)?\s*/i, '').trim();
  const r = await fetch('/api/reminders').then(x => x.json());
  const match = (r.reminders || []).find(rem => rem.text.toLowerCase().includes(query.toLowerCase()));
  if (!match) { addMessage('ai', `⏰ No reminder found matching _"${query}"_${boss}.`); return; }
  await fetch(`/api/reminders/${match.id}`, { method: 'DELETE' });
  addMessage('ai', `⏰ Deleted reminder${boss}: **"${match.text}"** ✅`);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function _chatAddTask(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const taskText = text.replace(/\badd\s+(a\s+)?task\s*(to\s+|for\s+)?\b/i, '').replace(/^(to|for)\s+/i, '').trim();
  if (!taskText || taskText.length < 2) { addMessage('ai', `✅ What task should I add${boss}? Say: _"add task review PR"_`); return; }
  const tasks = JSON.parse(localStorage.getItem('jarvisTasks') || '[]');
  tasks.unshift({ text: taskText, done: false, createdAt: new Date().toISOString() });
  localStorage.setItem('jarvisTasks', JSON.stringify(tasks));
  const activeCount = tasks.filter(t => !t.done).length;
  addMessage('ai', `✅ Task added${boss}: **"${taskText}"** — You have ${activeCount} active task${activeCount!==1?'s':''}.`);
  speak(`Task added${boss}: ${taskText}`);
  _logAudit('task_added', taskText.slice(0,100));
}

function _chatListTasks() {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', 'show my tasks');
  const tasks = JSON.parse(localStorage.getItem('jarvisTasks') || '[]');
  const active = tasks.filter(t => !t.done), done = tasks.filter(t => t.done);
  if (!tasks.length) { addMessage('ai', `✅ No tasks yet${boss}. Say _"add task [name]"_ to create one.`); return; }
  let msg = `✅ **Tasks${boss}** (${active.length} active, ${done.length} done):\n\n`;
  if (active.length) msg += active.map(t => `- ☐ ${t.text}`).join('\n') + '\n\n';
  if (done.length) msg += '**Completed:**\n' + done.slice(0,5).map(t => `- ☑ ~~${t.text}~~`).join('\n');
  addMessage('ai', msg);
  speak(`You have ${active.length} active task${active.length!==1?'s':''}${boss}.`);
}

function _chatCompleteTask(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const query = text.replace(/\b(complete|finish|done|mark\s+done|check\s+off)\s+(task\s+)?\b/i, '').trim();
  const tasks = JSON.parse(localStorage.getItem('jarvisTasks') || '[]');
  const idx = tasks.findIndex(t => !t.done && t.text.toLowerCase().includes(query.toLowerCase()));
  if (idx === -1) { addMessage('ai', `✅ No active task matching _"${query}"_${boss}.`); return; }
  tasks[idx].done = true;
  localStorage.setItem('jarvisTasks', JSON.stringify(tasks));
  addMessage('ai', `✅ Marked done${boss}: **"${tasks[idx].text}"** ☑`);
  speak(`Done${boss}: ${tasks[idx].text}`);
}

// ─── Pomodoro ─────────────────────────────────────────────────────────────────
function _chatPomodoro(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  const lo = text.toLowerCase();
  addMessage('user', text);
  if (/start|begin|go/.test(lo)) {
    if (_pomodoroRunning) { addMessage('ai', `⏱ Pomodoro already running${boss}. ${Math.floor(_pomodoroSecs/60)} minutes left.`); return; }
    _pomodoroSecs = 25*60; _pomodoroMode = 'work'; _pomodoroRunning = true;
    _pomodoroTimer = setInterval(() => {
      _pomodoroSecs--;
      _updatePomoDisplay();
      if (_pomodoroSecs <= 0) {
        clearInterval(_pomodoroTimer); _pomodoroRunning = false;
        const wasWork = _pomodoroMode === 'work';
        _pomodoroMode = wasWork ? 'break' : 'work'; _pomodoroSecs = wasWork ? 5*60 : 25*60;
        const msg = wasWork ? `⏰ Pomodoro complete${boss}! Take a 5-minute break.` : `💪 Break over${boss}! Back to work.`;
        if (Notification.permission === 'granted') new Notification('JARVIS', { body: msg });
        addMessage('ai', msg); speak(msg.replace(/[*_]/g,''));
      }
    }, 1000);
    addMessage('ai', `⏱ Pomodoro started${boss}! **25-minute** work session. I'll notify you when done.`);
    speak(`Pomodoro started${boss}. 25 minutes.`);
  } else if (/stop|pause|halt/.test(lo)) {
    clearInterval(_pomodoroTimer); _pomodoroRunning = false;
    addMessage('ai', `⏸ Pomodoro paused${boss}. **${Math.floor(_pomodoroSecs/60)}:${String(_pomodoroSecs%60).padStart(2,'0')}** remaining.`);
    speak(`Paused${boss}.`);
  } else if (/reset|restart/.test(lo)) {
    clearInterval(_pomodoroTimer); _pomodoroRunning = false; _pomodoroSecs = 25*60; _pomodoroMode = 'work'; _updatePomoDisplay();
    addMessage('ai', `↺ Pomodoro reset${boss}. Ready for a 25-minute session.`);
  } else if (/skip/.test(lo)) {
    clearInterval(_pomodoroTimer); _pomodoroRunning = false;
    _pomodoroMode = _pomodoroMode === 'work' ? 'break' : 'work'; _pomodoroSecs = _pomodoroMode === 'work' ? 25*60 : 5*60; _updatePomoDisplay();
    addMessage('ai', `⏭ Skipped to **${_pomodoroMode}** session${boss}.`);
  } else {
    const m = Math.floor(_pomodoroSecs/60), s = _pomodoroSecs%60;
    const st = _pomodoroRunning ? `running — **${m}:${String(s).padStart(2,'0')}** remaining (${_pomodoroMode})` : 'stopped';
    addMessage('ai', `⏱ Pomodoro ${st}${boss}.\n\nSay _"start pomodoro"_, _"pause pomodoro"_, _"reset pomodoro"_, or _"skip pomodoro"_.`);
  }
}

// ─── Notes ────────────────────────────────────────────────────────────────────
async function _chatAddNote(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const stripped = text.replace(/\b(new|add|create|write|save)\s+(a\s+)?note\b\s*:?\s*/i, '').trim();
  let title = stripped, content = '';
  const sep = stripped.indexOf(':');
  if (sep > 0) { title = stripped.slice(0, sep).trim(); content = stripped.slice(sep+1).trim(); }
  if (!title) { addMessage('ai', `📝 Format: _"new note [title]: [content]"_${boss}`); return; }
  const r = await fetch('/api/notes', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, content, tags:[] }) }).then(x => x.json());
  if (r.success) {
    addMessage('ai', `📝 Note saved${boss}: **"${title}"**${content ? '\n\n> ' + content.slice(0,120) : ''} ✅`);
    speak(`Note saved${boss}: ${title}`); _logAudit('note_added', title.slice(0,100));
  } else { addMessage('ai', `⚠️ Could not save note: ${r.error}`); }
}

async function _chatListNotes() {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', 'show my notes');
  const r = await fetch('/api/notes').then(x => x.json());
  const notes = r.notes || [];
  if (!notes.length) { addMessage('ai', `📝 No notes yet${boss}. Say _"new note [title]"_ to create one.`); return; }
  const list = notes.slice(0,10).map(n => `- **${n.title}**${n.tags?.length?' · '+n.tags.join(', '):''} · _${new Date(n.updatedAt).toLocaleDateString()}_`).join('\n');
  addMessage('ai', `📝 **Your Notes${boss}** (${notes.length} total):\n\n${list}${notes.length>10?`\n\n_...${notes.length-10} more in Notes panel._`:''}`);
  speak(`You have ${notes.length} note${notes.length>1?'s':''}${boss}.`);
}

async function _chatSearchNotes(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const query = text.replace(/\bsearch\s+(my\s+)?notes?\s*(for\s+)?\b/i,'').trim();
  if (!query) { addMessage('ai', `📝 What to search for in your notes${boss}?`); return; }
  const r = await fetch('/api/notes').then(x => x.json());
  const matches = (r.notes||[]).filter(n => n.title.toLowerCase().includes(query.toLowerCase()) || n.content.toLowerCase().includes(query.toLowerCase()));
  if (!matches.length) { addMessage('ai', `📝 No notes found matching _"${query}"_${boss}.`); return; }
  const list = matches.slice(0,5).map(n => `- **${n.title}**: ${n.content.slice(0,80)}${n.content.length>80?'…':''}`).join('\n');
  addMessage('ai', `📝 **Notes matching "${query}"${boss}** (${matches.length} found):\n\n${list}`);
}

// ─── Processes ────────────────────────────────────────────────────────────────
async function _chatShowProcesses(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text || 'show running processes');
  setStatus('🖥 SCANNING PROCESSES...');
  const r = await fetch('/api/process-monitor').then(x => x.json());
  setStatus('✓ SYSTEM ONLINE');
  const procs = r.processes || [];
  if (!procs.length) { addMessage('ai', `🖥 Could not read processes${boss}.`); return; }
  const list = procs.slice(0,12).map(p => `- **${p.name}** · PID ${p.pid} · ${(p.memKB/1024).toFixed(0)} MB`).join('\n');
  addMessage('ai', `🖥 **Top 12 Processes by Memory${boss}:**\n\n${list}\n\nSay _"kill process [name]"_ to terminate one.`);
  speak(`Showing top ${Math.min(12,procs.length)} processes${boss}.`);
}

async function _chatKillProcess(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const name = text.replace(/\b(kill|end|terminate|close|stop)\s+(process|program|app|task)\s*/i,'').trim();
  if (!name) { addMessage('ai', `🖥 Which process to kill${boss}? Say: _"kill process notepad"_`); return; }
  const r = await fetch('/api/process-monitor').then(x => x.json());
  const match = (r.processes||[]).find(p => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!match) { addMessage('ai', `🖥 No process found matching _"${name}"_${boss}.`); return; }
  const kr = await fetch('/api/process-monitor/kill', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pid: match.pid }) }).then(x => x.json());
  if (kr.success) {
    addMessage('ai', `🖥 Killed **${match.name}** (PID ${match.pid})${boss}. ✅`);
    speak(`${match.name} terminated${boss}.`); _logAudit('process_killed', `${match.name} PID:${match.pid}`);
  } else { addMessage('ai', `🖥 Failed to kill ${match.name}: ${kr.error}`); }
}

// ─── Network ──────────────────────────────────────────────────────────────────
async function _chatNetwork(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text || 'check network');
  setStatus('🌐 CHECKING NETWORK...');
  const r = await fetch('/api/network-info').then(x => x.json());
  setStatus('✓ SYSTEM ONLINE');
  const status = r.online ? '🟢 **ONLINE**' : '🔴 **OFFLINE**';
  const ping   = r.pingMs != null ? ` · Ping: **${r.pingMs}ms**` : '';
  const ifaces = (r.interfaces||[]).flatMap(i => i.addresses.map(a => `- **${i.name}**: \`${a.address}\` (${a.family})`)).join('\n');
  addMessage('ai', `🌐 **Network Status${boss}:** ${status}${ping}\n\n${ifaces||'No interfaces found'}`);
  speak(`Network is ${r.online?'online':'offline'}${boss}${r.pingMs?', ping '+r.pingMs+' milliseconds':''}.`);
}

// ─── Windows ──────────────────────────────────────────────────────────────────
async function _chatListWindows(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text || 'list open windows');
  setStatus('🪟 SCANNING WINDOWS...');
  const r = await fetch('/api/windows').then(x => x.json());
  setStatus('✓ SYSTEM ONLINE');
  if (!r.windows?.length) { addMessage('ai', `🪟 No open windows found${boss}.`); return; }
  const list = r.windows.slice(0,12).map(w => `- **${w.MainWindowTitle||w.ProcessName}** (${w.ProcessName}, PID ${w.Id})`).join('\n');
  addMessage('ai', `🪟 **Open Windows${boss}** (${r.windows.length}):\n\n${list}\n\nSay _"focus [name]"_ or _"close [name]"_ to control.`);
  speak(`${r.windows.length} open windows${boss}.`);
}

async function _chatWindowAction(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const isClose = /\bclose\b/i.test(text), isFocus = /\bfocus\b/i.test(text);
  const target  = text.replace(/\b(focus|close|minimize|maximize)\s+(the\s+|window\s+|app\s+)?/i,'').trim();
  if (!target) { addMessage('ai', `🪟 Which window${boss}? Say: _"focus chrome"_ or _"close notepad"_`); return; }
  const r = await fetch('/api/windows').then(x => x.json());
  const win = (r.windows||[]).find(w => (w.MainWindowTitle||'').toLowerCase().includes(target.toLowerCase()) || (w.ProcessName||'').toLowerCase().includes(target.toLowerCase()));
  if (!win) { addMessage('ai', `🪟 No window matching _"${target}"_${boss}.`); return; }
  const action = isClose ? 'close' : 'focus';
  const ar = await fetch('/api/windows/action', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pid: win.Id, action }) }).then(x => x.json());
  if (ar.success) {
    addMessage('ai', `🪟 ${isClose?'Closed':'Focused'} **${win.MainWindowTitle||win.ProcessName}**${boss}. ✅`);
    speak(`${isClose?'Closed':'Focused'} ${win.MainWindowTitle||win.ProcessName}${boss}.`); _logAudit(`window_${action}`, win.ProcessName);
  } else { addMessage('ai', `🪟 Failed to ${action} window: ${ar.error}`); }
}

// ─── Git ──────────────────────────────────────────────────────────────────────
async function _chatGit(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const m = text.match(/\bgit\s+(status|log|diff|branch|push|pull|fetch|stash|checkout|reset|remote|show|add|commit)\b(.*)?$/i);
  if (!m) { addMessage('ai', `🔧 Specify a git command${boss}. Example: _"git status"_, _"git log"_`); return; }
  const sub = m[1].toLowerCase(), args = (m[2]||'').trim();
  const cwd = localStorage.getItem('jarvisGitCwd') || '';
  setStatus(`🔧 GIT ${sub.toUpperCase()}...`);
  const r = await fetch('/api/git', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ cwd, subcommand: sub, args }) }).then(x => x.json());
  setStatus('✓ SYSTEM ONLINE');
  addMessage('ai', `🔧 **git ${sub}${args?' '+args:''}${boss}:**\n\n\`\`\`\n${(r.output||r.error||'(no output)').slice(0,1500)}\n\`\`\``);
  speak(`Git ${sub} complete${boss}.`); _logAudit('git_command', `git ${sub} ${args}`);
}

// ─── Inline Code Runner ───────────────────────────────────────────────────────
function _detectInlineCode(text) {
  return /```[\s\S]{2,}```/.test(text) && /\b(run|execute|eval)\b/i.test(text);
}

async function _chatRunInlineCode(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const blockMatch = text.match(/```(\w+)?\n?([\s\S]+?)```/);
  if (!blockMatch) { addMessage('ai', `💻 Wrap code in \`\`\` backticks${boss}. Example: _run: \`\`\`js\\nconsole.log('hi')\\n\`\`\`_`); return; }
  const lang = (blockMatch[1]||'javascript').toLowerCase().replace(/^(node|js)$/,'javascript');
  const code = blockMatch[2].trim();
  setStatus('💻 RUNNING CODE...');
  const r = await fetch('/api/run-code', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code, language: lang }) }).then(x => x.json());
  setStatus('✓ SYSTEM ONLINE');
  const out = r.success ? (r.output||'(no output)') : '❌ '+(r.error||'Error');
  addMessage('ai', `💻 **Code output${boss}** (${lang}):\n\n\`\`\`\n${out.slice(0,1000)}\n\`\`\``);
  speak(`Code executed${boss}. ${r.output?'Output: '+r.output.slice(0,60):'No output.'}`);
  _logAudit('code_run', lang);
}

// ─── Vision AI ────────────────────────────────────────────────────────────────
async function _chatVision(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const question = text.replace(/\b(analyze|analyse|look\s+at|describe|what\s+do\s+you\s+see|take\s+a\s+screenshot\s+and|screen\s+analysis)\b/gi,'').replace(/\b(my\s+)?(screen|image|photo|picture)\b/gi,'').trim() || 'Describe what you see in detail';
  addMessage('ai', `👁 Starting screen capture${boss}. Select the window to share…`);
  speak(`Opening screen capture${boss}.`);
  try {
    const stream  = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track   = stream.getVideoTracks()[0];
    const capture = new ImageCapture(track);
    const bitmap  = await capture.grabFrame();
    track.stop();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) { addMessage('ai', `👁 Screen capture failed${boss}.`); return; }
      setStatus('👁 ANALYZING IMAGE...');
      const form = new FormData(); form.append('image', blob, 'screen.jpg'); form.append('question', question);
      const r = await fetch('/api/vision', { method:'POST', body: form }).then(x => x.json());
      setStatus('✓ SYSTEM ONLINE');
      if (r.success) { addMessage('ai', `👁 **Vision Analysis${boss}:**\n\n${r.answer}`); speak(`Analysis complete${boss}.`); }
      else { addMessage('ai', `👁 Vision failed${boss}: ${r.error}`); }
    }, 'image/jpeg', 0.85);
  } catch(e) { addMessage('ai', `👁 Screen capture cancelled or not supported${boss}: ${e.message}`); }
}

// ─── Image Generation (inline in chat) ───────────────────────────────────────
async function _chatImageGen(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text);
  const prompt = text.replace(/\b(generate|create|make|draw|show\s+me|give\s+me)\s+(a\s+|an\s+)?(image|picture|photo|illustration|wallpaper|art|painting)\b\s*(of\s+|showing\s+|depicting\s+)?/i,'').trim();
  if (!prompt||prompt.length<3) { addMessage('ai', `🖼 Describe the image${boss}. Example: _"generate image of a futuristic city at night"_`); return; }
  setStatus('🖼 GENERATING IMAGE...');
  addMessage('ai', `🖼 Generating image${boss}: **"${prompt}"** — this takes 10-20 seconds…`);
  const r = await fetch('/api/image-gen', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt }) }).then(x => x.json());
  setStatus('✓ SYSTEM ONLINE');
  if (!r.success) { addMessage('ai', `🖼 Image generation failed${boss}: ${r.error}`); return; }
  // Insert image directly into chat DOM
  const msgs = document.getElementById('messages');
  if (msgs) {
    const div = document.createElement('div'); div.className = 'msg ai';
    div.innerHTML = `<div class="avatar ai">⬡</div><div class="bubble ai">
      🖼 <strong>Generated Image${boss}:</strong> <em>"${_esc(prompt)}"</em><br><br>
      <img src="${r.imageUrl}" alt="${_esc(prompt)}" loading="lazy"
        style="max-width:100%;max-height:400px;border-radius:8px;border:1px solid rgba(0,212,255,0.3);display:block;margin-top:6px"
        onerror="this.outerHTML='<p style=\\'color:#ff5252\\'>Image load failed. <a href=\\'${r.imageUrl}\\' target=\\'_blank\\' style=\\'color:#00d4ff\\'>Open direct link</a></p>'"
      /><br>
      <a href="${r.imageUrl}" target="_blank" rel="noopener" style="color:var(--accent);font-size:11px;font-family:var(--font-mono)">🔗 Full size</a>
      &nbsp;&nbsp;<a href="${r.imageUrl}" download="jarvis-${Date.now()}.jpg" style="color:var(--accent);font-size:11px;font-family:var(--font-mono)">📥 Download</a>
    </div>`;
    msgs.appendChild(div); scrollToBottom(); speak(`Image generated${boss}: ${prompt}`);
  }
  _logAudit('image_generated', prompt.slice(0,100));
}

// ─── Screen Recorder ──────────────────────────────────────────────────────────
async function _chatScreenRecord(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  const lo = text.toLowerCase();
  addMessage('user', text);
  if (/stop|end|finish/.test(lo) && _recordingActive) {
    _mediaRecorder?.stop(); _mediaRecorder?.stream?.getTracks().forEach(t => t.stop());
    _recordingActive = false;
    addMessage('ai', `📹 Recording stopped${boss}. Processing video…`); speak(`Recording stopped${boss}.`);
    openToolsPanel('recorder');
  } else if (!_recordingActive) {
    addMessage('ai', `📹 Starting screen recorder${boss}. Select what to record…`);
    speak(`Starting screen recorder${boss}.`); openToolsPanel('recorder');
    await new Promise(res => setTimeout(res, 500)); _toggleRecording();
  } else {
    addMessage('ai', `📹 Recording in progress${boss}. Say _"stop recording"_ to save.`);
  }
}

// ─── Transcription ────────────────────────────────────────────────────────────
async function _chatTranscribe(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  const lo = text.toLowerCase();
  addMessage('user', text);
  openToolsPanel('transcribe');
  await new Promise(res => setTimeout(res, 500));
  if (/start|begin|record/.test(lo) && !_transcribeRecording) {
    _toggleTranscribeRecord();
    addMessage('ai', `🎙 Transcription recording started${boss}. Say _"stop transcription"_ when done.`);
    speak(`Recording started${boss}.`);
  } else if (/stop|end|finish/.test(lo) && _transcribeRecording) {
    _transcribeRecorder?.stop(); _transcribeRecording = false;
    addMessage('ai', `🎙 Transcription stopped${boss}. Processing audio…`);
  } else {
    addMessage('ai', `🎙 Transcription panel open${boss}. Say _"start transcription"_ to begin recording.`);
  }
}

// ─── Breach Check ─────────────────────────────────────────────────────────────
async function _chatBreachCheck(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  // Don't echo the password in chat
  addMessage('user', text.replace(/\b(\S{3,})\s*$/, '[password hidden]'));
  const m = text.match(/(?:is\s+|check\s+(?:if\s+)?|test\s+)["']?([^\s"']+)["']?\s+(?:safe|pwned|leaked?|compromised|secure)\b/i)
         || text.match(/["']([^"']{3,})["']\s*(?:safe|pwned|leaked?)/i);
  if (!m) { addMessage('ai', `🛡 How to use${boss}: _"is 'mypassword' safe?"_ or _"check 'abc123' pwned"_\n\n_Only a 5-char SHA-1 hash prefix is sent — your password is never exposed._`); return; }
  const pw = m[1];
  setStatus('🛡 CHECKING BREACH...');
  const r = await fetch('/api/breach-check', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pw }) }).then(x => x.json());
  setStatus('✓ SYSTEM ONLINE');
  if (!r.success) { addMessage('ai', `🛡 Breach check failed${boss}: ${r.error}`); return; }
  if (r.pwned) {
    addMessage('ai', `🛡 **⚠️ COMPROMISED${boss}!** That password has been seen **${r.count.toLocaleString()} times** in data breaches.\n\n_Change it immediately everywhere it is used._`);
    speak(`Warning${boss}. That password is compromised. Change it immediately.`);
  } else {
    addMessage('ai', `🛡 **✅ SAFE${boss}!** Not found in any known breach database.\n\n_Make sure it's unique and complex too._`);
    speak(`Password is safe${boss}. Not found in any breach.`);
  }
}

// ─── Audit Log ────────────────────────────────────────────────────────────────
async function _chatAuditLog(text) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  addMessage('user', text || 'show audit log');
  const r = await fetch('/api/audit-log').then(x => x.json());
  const log = (r.log||[]).slice(-20).reverse();
  if (!log.length) { addMessage('ai', `📜 Audit log is empty${boss}.`); return; }
  const list = log.slice(0,10).map(e => `- **${e.action}** · ${e.detail?e.detail.slice(0,60):''} · _${new Date(e.timestamp).toLocaleTimeString()}_`).join('\n');
  addMessage('ai', `📜 **Recent Activity${boss}** (last 10 actions):\n\n${list}`);
  speak(`Showing your recent activity${boss}.`);
}

// ─── Open Panel helper ────────────────────────────────────────────────────────
function _openPanel(tab, label) {
  const boss = isVerifiedBoss ? ', Boss' : '';
  openToolsPanel(tab);
  addMessage('ai', `🛠 Opened **${label}**${boss}.`);
  speak(`Opening ${label}${boss}.`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — handleToolsCommand
// Called from sendMessage() as the FIRST intercept (before AI call).
// Handles every tool action directly in chat from speech or text instruction.
// ═══════════════════════════════════════════════════════════════════════════════
async function handleToolsCommand(text) {
  if (!text?.trim()) return false;
  const t  = text.trim();
  const lo = t.toLowerCase();

  // ── 0. Inline code blocks ──────────────────────────────────────────────────
  if (_detectInlineCode(t)) { await _chatRunInlineCode(t); return true; }

  // ── 1. News (PRIORITY — also feeds AI context in chat.js) ─────────────────
  if (_detectNewsQuery(t)) { await _chatNews(t); return true; }

  // ── 2. Reminders ──────────────────────────────────────────────────────────
  if (/\b(add|set|create|put)\s+(a\s+)?reminder\b|\bremind\s+(me|us)\b|\bset\s+an?\s+alarm\b/i.test(lo)) { await _chatAddReminder(t); return true; }
  if (/\b(list|show|display|what\s+are)\s+(my\s+)?reminders?\b|\bmy\s+reminders?\b/i.test(lo))           { await _chatListReminders(); return true; }
  if (/\b(delete|remove|cancel|clear)\s+(reminder|alarm)\b/i.test(lo))                                   { await _chatDeleteReminder(t); return true; }

  // ── 3. Tasks ───────────────────────────────────────────────────────────────
  if (/\badd\s+(a\s+)?task\b/i.test(lo))                                                                  { _chatAddTask(t); return true; }
  if (/\b(list|show|what\s+are)\s+(my\s+)?tasks?\b|\bmy\s+tasks?\b|\btodo\s+list\b/i.test(lo))           { _chatListTasks(); return true; }
  if (/\b(complete|finish|done|mark\s+done|check\s+off)\s+(task\s+)?\b/i.test(lo))                       { _chatCompleteTask(t); return true; }

  // ── 4. Pomodoro ────────────────────────────────────────────────────────────
  if (/\bpomodoro\b|\bfocus\s+timer\b/i.test(lo)) { _chatPomodoro(t); return true; }

  // ── 5. Notes ───────────────────────────────────────────────────────────────
  if (/\b(new|add|create|write|save)\s+(a\s+)?note\b/i.test(lo))                             { await _chatAddNote(t); return true; }
  if (/\b(list|show|display|what\s+are)\s+(my\s+)?notes?\b|\bmy\s+notes?\b/i.test(lo))      { await _chatListNotes(); return true; }
  if (/\bsearch\s+(my\s+)?notes?\b/i.test(lo))                                               { await _chatSearchNotes(t); return true; }

  // ── 6. Vault (needs UI) ────────────────────────────────────────────────────
  if (/\b(open|show|access|unlock)\s+(password\s+)?(vault|locker|safe)\b|\bmy\s+passwords?\b|\bpassword\s+vault\b/i.test(lo)) { _openPanel('vault','🔐 Password Vault'); return true; }

  // ── 7. Clipboard (needs UI) ───────────────────────────────────────────────
  if (/\bclipboard\s+history\b|\b(show|open)\s+clipboard\b|\bwhat.{0,10}\bclipboard\b/i.test(lo)) { _openPanel('clipboard','📋 Clipboard'); return true; }

  // ── 8. Processes ──────────────────────────────────────────────────────────
  if (/\bkill\s+(process|app|program|task)\b/i.test(lo))                                                                   { await _chatKillProcess(t); return true; }
  if (/\b(show|list|what|display)\s+(running\s+|active\s+)?(processes?|tasks?)\b|\b(open|show)\s+task\s+manager\b|\btop\s+processes?\b/i.test(lo)) { await _chatShowProcesses(t); return true; }

  // ── 9. Network ────────────────────────────────────────────────────────────
  if (/\b(check|test|show|what.{0,10}my)\s+(network|internet|connection|wifi|ip\s*address?|ping)\b|\bam\s+i\s+(online|connected)\b|\bmy\s+ip\b|\bcheck\s+network\b/i.test(lo)) { await _chatNetwork(t); return true; }

  // ── 10. Windows ───────────────────────────────────────────────────────────
  if (/\b(close|focus|minimize)\s+(the\s+|window\s+|app\s+)?(\w[\w\s]{1,30})/i.test(lo) && !/\b(jarvis|tools?|panel)\b/i.test(lo)) { await _chatWindowAction(t); return true; }
  if (/\b(list|show|what)\s+(open|running|active)?\s*windows?\b|\bopen\s+windows?\b/i.test(lo)) { await _chatListWindows(t); return true; }

  // ── 11. Git ───────────────────────────────────────────────────────────────
  if (/\bgit\s+(status|log|diff|branch|push|pull|fetch|stash|checkout|reset|remote|show|add|commit)\b/i.test(lo)) { await _chatGit(t); return true; }

  // ── 12. Code Runner (panel for manual editing) ────────────────────────────
  if (/\b(open|show)\s+code\s+runner\b|\bopen\s+code\b/i.test(lo))                                { _openPanel('coderunner','💻 Code Runner'); return true; }
  if (/\brun\s+(python|javascript|js|node|code)\b(?!.*```)/i.test(lo))                             { _openPanel('coderunner','💻 Code Runner'); return true; }

  // ── 13. Breach Check ──────────────────────────────────────────────────────
  if (/\b(is|check|test)\s+.{2,40}\s+(safe|pwned|leaked?|compromised|secure)\b/i.test(lo) || /\bcheck.{0,30}password.{0,30}(leak|breach|pwned)\b/i.test(lo)) { await _chatBreachCheck(t); return true; }
  if (/\b(open|show)\s+breach\b|\bhaveibeenpwned\b/i.test(lo))                                     { _openPanel('breach','🛡 Breach Check'); return true; }

  // ── 14. Transcription ─────────────────────────────────────────────────────
  if (/\b(start|begin|stop|end)\s+(audio\s+)?transcri(be|ption|bing)\b|\btranscribe\s+(my\s+)?(meeting|audio|recording)\b|\b(open|show)\s+transcri/i.test(lo)) { await _chatTranscribe(t); return true; }

  // ── 15. Vision AI ─────────────────────────────────────────────────────────
  if (/\b(analyze|analyse|look\s+at|describe)\s+(the\s+)?(screen|image|photo|picture)\b|\bwhat\s+do\s+you\s+see\b|\btake\s+a\s+screenshot\s+and\b|\bscreen\s+analysis\b|\b(open|show)\s+vision\b/i.test(lo)) { await _chatVision(t); return true; }

  // ── 16. Image Generation ──────────────────────────────────────────────────
  if (/\b(generate|create|make|draw|show\s+me)\s+(a\s+|an\s+)?(image|picture|photo|wallpaper|illustration|art|painting)\b/i.test(lo)) { await _chatImageGen(t); return true; }
  if (/\b(open|show)\s+image\s+gen(eration)?\b/i.test(lo))                                          { _openPanel('imagegen','🖼 Image Gen'); return true; }

  // ── 17. Screen Recorder ───────────────────────────────────────────────────
  if (/\b(start|begin|stop|end|finish)\s+screen\s+record(ing)?\b|\brecord\s+(my\s+)?screen\b|\b(open|show)\s+(screen\s+)?recorder\b/i.test(lo)) { await _chatScreenRecord(t); return true; }

  // ── 18. Audit Log ─────────────────────────────────────────────────────────
  if (/\b(show|view|open|list)\s+(activity|command|audit)?\s*(log|history)\b|\bwhat\s+(have\s+i|did\s+i)\s+(done|asked|run)\b|\bmy\s+activity\b/i.test(lo)) { await _chatAuditLog(t); return true; }

  // ── 19. Telegram ──────────────────────────────────────────────────────────
  if (/\btelegram\s+bot\b|\b(open|show|setup)\s+telegram\b/i.test(lo)) { _openPanel('telegram','🤖 Telegram Bot'); return true; }

  // ── 20. Generic tools panel ───────────────────────────────────────────────
  if (/\b(open|show|launch)\s+(jarvis\s+)?tools?\b|\btools?\s+panel\b/i.test(lo)) {
    openToolsPanel();
    addMessage('ai', `🛠 Tools panel opened${isVerifiedBoss?', Boss':''}. Available: ⏰ Reminders · ✅ Tasks · 📝 Notes · 🔐 Vault · 📋 Clipboard · 🖥 Processes · 🌐 Network · 🪟 Windows · 🔧 Git · 💻 Code · 📰 News · 🛡 Breach · 🎙 Transcribe · 👁 Vision · 🖼 Image Gen · 📹 Recorder · 📜 Audit · 🤖 Telegram`);
    speak(`Tools panel opened${isVerifiedBoss?', Boss':''}.`);
    return true;
  }

  return false;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(_hookAuditLog, 1000);
});
