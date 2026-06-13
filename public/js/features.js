// ═══════════════════════════════════════════════
// JARVIS — Feature Development System
// ═══════════════════════════════════════════════

function loadFeatureData() {
  const saved = localStorage.getItem('jarvisFeatures');
  if (saved) {
    try {
      const d = JSON.parse(saved);
      featureRequests     = d.requests  || [];
      implementedFeatures = d.implemented || [];
      learningDatabase    = d.learning  || learningDatabase;
    } catch(e) {}
  }
  const td = localStorage.getItem('jarvisTrainingData');
  if (td) { try { trainingData = JSON.parse(td); } catch(e) {} }
}

function saveFeatureData() {
  localStorage.setItem('jarvisFeatures', JSON.stringify({
    requests:    featureRequests,
    implemented: implementedFeatures,
    learning:    learningDatabase
  }));
}

function toggleDevModal() {
  const overlay = document.getElementById('devModal');
  if (!overlay) return;
  overlay.classList.toggle('open');
  if (overlay.classList.contains('open')) {
    const resp = document.getElementById('devResponse');
    if (resp) resp.style.display = 'none';
    displayFeaturesList();
    loadCodebaseContext();
  }
}

function selectFeatureType(btn) {
  document.querySelectorAll('.ftype-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('featureType').value = btn.dataset.value;
}

async function submitFeatureRequest() {
  const descEl = document.getElementById('featureDesc');
  const desc   = descEl?.value?.trim();
  if (!desc) { alert('Please describe the feature you want.'); return; }

  const response = document.getElementById('devResponse');
  response.style.display = 'block';
  response.innerHTML = `<div class="notice info">⚙️ JARVIS is generating your feature…</div>`;

  try {
    const res = await fetch('/api/develop-feature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc, userProfile, currentMode, language: currentLanguage })
    });
    const data = await res.json();

    // Track in training data
    trainingData.features.push(desc);
    trainingData.patterns.push({ request: desc, type: data.type || 'custom', timestamp: new Date() });
    localStorage.setItem('jarvisTrainingData', JSON.stringify(trainingData));

    if (data.success) {
      window._pendingFeature = data;
      response.innerHTML = `
        <div class="notice success">
          ✅ <strong>${data.featureName}</strong> — code generated!<br>
          <small style="color:var(--text-secondary)">${data.description}</small>
        </div>
        <div class="dev-action-row">
          <button class="btn btn-primary" onclick="applyFeatureToLocalFiles()">🔧 APPLY TO LOCAL FILES</button>
          <button class="btn btn-secondary" onclick="window._pendingFeature=null;document.getElementById('devResponse').style.display='none'">✗ DISCARD</button>
        </div>`;
      addMessage('ai', `✅ **Feature Developed: ${data.featureName}**\n${data.description}\n\n\`\`\`javascript\n${data.js || '// (no JS generated)'}\n\`\`\`\n\nClick **🔧 APPLY TO LOCAL FILES** in the dev panel to write this to the project.`);
      developedFeatures.push(data);
    } else {
      response.innerHTML = `<div class="notice error">❌ ${data.error || 'Generation failed'}</div>`;
    }
  } catch(err) {
    response.innerHTML = `<div class="notice error">❌ ${err.message}</div>`;
  }
}

async function applyFeatureToLocalFiles() {
  const feat = window._pendingFeature;
  if (!feat) { alert('No pending feature to apply.'); return; }
  const resp = document.getElementById('devResponse');
  resp.innerHTML = `<div class="notice info">🔧 Writing "${feat.featureName}" to disk…</div>`;
  try {
    const res  = await fetch('/api/apply-feature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ js: feat.js, css: feat.css, html: feat.html, type: feat.type, featureName: feat.featureName })
    });
    const out = await res.json();
    if (out.success) {
      resp.innerHTML = `
        <div class="notice success">
          ✅ <strong>${feat.featureName}</strong> applied to <code>${out.file}</code>!
          ${out.requiresReload  ? `<br><button class="btn btn-primary" style="margin-top:8px" onclick="location.reload()">🔄 RELOAD PAGE</button>` : ''}
          ${out.requiresRestart ? `<br><small style="color:var(--amber)">⚠️ Restart the server to activate backend changes.</small>` : ''}
        </div>`;
      window._pendingFeature = null;
      learningDatabase.successfulImplementations++;
      saveFeatureData();
    } else {
      resp.innerHTML = `<div class="notice error">❌ ${out.error}</div>`;
    }
  } catch(err) {
    resp.innerHTML = `<div class="notice error">❌ ${err.message}</div>`;
  }
}

async function performSearch() {
  const query = document.getElementById('featureDesc')?.value?.trim();
  if (!query) { alert('Enter a search term first.'); return; }
  const response = document.getElementById('devResponse');
  response.style.display = 'block';
  response.innerHTML = `<div class="notice info">🔍 Searching…</div>`;
  try {
    const res  = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, language: currentLanguage })
    });
    const data = await res.json();
    trainingData.searches.push(query);
    localStorage.setItem('jarvisTrainingData', JSON.stringify(trainingData));
    if (data.results?.length) {
      response.innerHTML = data.results.slice(0,3).map(r => `
        <div class="feature-card">
          <div class="feature-card-name">${r.title}</div>
          <div style="color:var(--text-secondary);font-size:11.5px;margin-top:4px">${r.snippet}</div>
          <div class="feature-card-type" style="margin-top:6px">🔗 ${r.url}</div>
        </div>`).join('');
    } else {
      response.innerHTML = `<div class="notice warning">No results found.</div>`;
    }
  } catch(err) {
    response.innerHTML = `<div class="notice error">❌ ${err.message}</div>`;
  }
}

async function loadCodebaseContext() {
  const container = document.getElementById('featuresList');
  try {
    const res  = await fetch('/api/codebase-context');
    const data = await res.json();
    if (data.success && container) {
      const lines = data.context.split('\n').filter(l => l.trim());
      const preview = lines.slice(0, 8).join('\n');
      const existing = container.innerHTML;
      const block = `<div class="notice info" style="margin-top:var(--sp4);font-family:var(--font-mono);font-size:10px;white-space:pre-wrap;line-height:1.7;max-height:120px;overflow-y:auto">${preview}</div>`;
      if (!existing.includes('JARVIS CODEBASE')) container.innerHTML = block + existing;
    }
  } catch(e) { /* silent */ }
}

function displayFeaturesList() {
  const container = document.getElementById('featuresList');
  if (!container) return;

  if (!implementedFeatures.length && !featureRequests.length) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:11.5px;text-align:center;padding:var(--sp5)">No features yet. Request one above!</div>`;
    return;
  }

  let html = '';

  if (implementedFeatures.length) {
    html += `<div class="dev-label" style="margin-top:var(--sp4)">✓ IMPLEMENTED</div>`;
    implementedFeatures.slice(-3).forEach(f => {
      html += `<div class="feature-card">
        <div class="feature-card-name">${f.description}</div>
        <div style="margin-top:5px"><span class="status-badge done">✓ Done</span>
        <span class="feature-card-type" style="margin-left:8px">${f.timestamp||''}</span></div>
      </div>`;
    });
  }

  if (featureRequests.length) {
    html += `<div class="dev-label" style="margin-top:var(--sp4)">⏳ PENDING</div>`;
    featureRequests.forEach(f => {
      html += `<div class="feature-card">
        <div class="feature-card-name">${f.description}</div>
        <div style="margin-top:5px"><span class="status-badge pending">⏳ Pending</span>
        <span class="feature-card-type" style="margin-left:8px">${f.type}</span></div>
      </div>`;
    });
  }

  // Learning insights
  const rate = learningDatabase.requestCount > 0
    ? Math.round(learningDatabase.successfulImplementations / learningDatabase.requestCount * 100)
    : 0;
  html += `<div class="learning-block">
    <h4>🧠 JARVIS LEARNING</h4>
    <div class="learning-item"><span class="li-icon">📊</span> Requested: ${learningDatabase.requestCount}</div>
    <div class="learning-item"><span class="li-icon">✓</span> Implemented: ${learningDatabase.successfulImplementations}</div>
    <div class="learning-item"><span class="li-icon">🎯</span> Success Rate: ${rate}%</div>
  </div>`;

  container.innerHTML = html;
}
