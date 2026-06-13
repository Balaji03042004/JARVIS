// ═══════════════════════════════════════════════
// JARVIS — Temple Search Feature
// ═══════════════════════════════════════════════

function toggleTempleSearch() {
  document.getElementById('templeSearchPanel').classList.toggle('open');
}

function setTempleFilter(btn) {
  document.querySelectorAll('.ts-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  templeFilter = btn.dataset.filter;
  if (document.getElementById('templeQuery').value.trim()) runTempleSearch();
}

function runTempleSearch() {
  const query   = document.getElementById('templeQuery').value.trim().toLowerCase();
  const results = document.getElementById('tsResults');

  let data = TEMPLE_DATA;

  if (templeFilter !== 'all') {
    data = data.filter(t =>
      t.religion === templeFilter ||
      t.location.includes(templeFilter) ||
      t.tags.some(tag => tag === templeFilter)
    );
  }

  if (query) {
    data = data.filter(t =>
      t.name.toLowerCase().includes(query)     ||
      t.location.toLowerCase().includes(query) ||
      t.deity.toLowerCase().includes(query)    ||
      t.desc.toLowerCase().includes(query)     ||
      t.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }

  if (!data.length) {
    results.innerHTML = `<div class="ts-empty">No temples found for "<strong>${query || templeFilter}</strong>"</div>`;
    return;
  }

  results.innerHTML = data.map(t => `
    <div class="ts-result">
      <div class="ts-result-name">🛕 ${t.name}</div>
      <div class="ts-result-loc">📍 ${t.location} &nbsp;|&nbsp; 🙏 ${t.deity}</div>
      <div class="ts-result-desc">${t.desc}</div>
      <div class="ts-result-tags">${t.tags.map(tag => `<span class="ts-tag">${tag}</span>`).join('')}</div>
    </div>`).join('');
}
