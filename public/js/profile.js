// ═══════════════════════════════════════════════
// JARVIS — User Profile & Stats
// ═══════════════════════════════════════════════

function loadProfile() {
  const saved = localStorage.getItem('jarvisUserProfile');
  if (saved) {
    try { userProfile = JSON.parse(saved); } catch(e) {}
  }
  // Always ensure Balaji is the registered owner
  if (!userProfile.name || userProfile.name === 'User') {
    userProfile.name = 'Balaji';
    localStorage.setItem('jarvisUserProfile', JSON.stringify(userProfile));
  }
  updateProfileUI();
}

function saveProfile() {
  const nameEl   = document.getElementById('userName');
  const domainEl = document.getElementById('userDomain');
  if (nameEl)   userProfile.name   = nameEl.value || 'User';
  if (domainEl) userProfile.domain = domainEl.value;
  userProfile.preferences.code    = document.getElementById('prefCode')?.checked    ?? true;
  userProfile.preferences.explain = document.getElementById('prefExplain')?.checked ?? true;
  userProfile.preferences.quick   = document.getElementById('prefQuick')?.checked   ?? false;
  localStorage.setItem('jarvisUserProfile', JSON.stringify(userProfile));
  updateStatsDisplay();
}

function updateProfileUI() {
  const nameEl   = document.getElementById('userName');
  const domainEl = document.getElementById('userDomain');
  if (nameEl)   nameEl.value   = userProfile.name;
  if (domainEl) domainEl.value = userProfile.domain;
  const prefCode    = document.getElementById('prefCode');
  const prefExplain = document.getElementById('prefExplain');
  const prefQuick   = document.getElementById('prefQuick');
  if (prefCode)    prefCode.checked    = userProfile.preferences.code;
  if (prefExplain) prefExplain.checked = userProfile.preferences.explain;
  if (prefQuick)   prefQuick.checked   = userProfile.preferences.quick;

  // Restore Boss-only voice toggle from localStorage
  const bossOnlyEl = document.getElementById('bossOnlyVoice');
  if (bossOnlyEl) bossOnlyEl.checked = localStorage.getItem('jarvisBossOnlyVoice') === 'true';

  // Restore noise threshold slider
  const noiseSlider = document.getElementById('noiseThreshSlider');
  const noiseVal    = document.getElementById('noiseThreshVal');
  const savedNoise  = localStorage.getItem('jarvisNoiseThreshold') || '0.018';
  if (noiseSlider) noiseSlider.value = savedNoise;
  if (noiseVal)    noiseVal.textContent = Math.round(parseFloat(savedNoise) * 1000);

  // Populate custom instructions textarea
  const ciEl = document.getElementById('customInstructions');
  if (ciEl && !ciEl._initialized) {
    ciEl.value = customInstructions;
    ciEl._initialized = true;
  }

  updateStatsDisplay();
}

function updateStatsDisplay() {
  const msgEl  = document.getElementById('statMessages');
  const sentEl = document.getElementById('statSentiment');
  const topEl  = document.getElementById('statTopics');
  const fbEl   = document.getElementById('statFeedback');

  if (msgEl)  msgEl.textContent  = userProfile.stats.messages;
  if (sentEl) sentEl.textContent = calculateAvgSentiment().emoji;
  if (topEl)  topEl.textContent  = new Set(userProfile.stats.topics).size;
  if (fbEl) {
    const arr = userProfile.stats.feedback;
    const avg = arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : '0.0';
    fbEl.textContent = avg + '/10';
  }
}

function toggleProfile() {
  const panel = document.getElementById('profilePanel');
  panel.classList.toggle('open');
  // Auto-load voices when panel opens
  if (panel.classList.contains('open') && typeof loadVoiceSelector === 'function') {
    setTimeout(loadVoiceSelector, 150);
  }
}

function saveCustomInstructions() {
  const ta = document.getElementById('customInstructions');
  if (!ta) return;
  customInstructions = ta.value;
  localStorage.setItem('jarvisCustomInstructions', customInstructions);
}

function exportProfile() {
  const json = JSON.stringify(userProfile, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'jarvis-profile.json'; a.click();
}
