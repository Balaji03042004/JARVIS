// ═══════════════════════════════════════════════
// JARVIS — Local Filesystem Access
// Intercepts file/folder queries and uses the
// real /api/filesystem endpoint (Node.js fs module)
// ═══════════════════════════════════════════════

let _lastFsPath    = null;  // Last accessed directory path
let _lastFsEntries = [];    // Last directory listing (for follow-up file detail questions)

// ── Detect if the user is asking about the local filesystem ──────────────────
function detectDriveListIntent(text) {
  return /\b(list|show|what|tell|all|available|my)\b.{0,20}\b(drives?|partitions?|disks?)\b/i.test(text)
      || /\bwhat\s+(drives?|disks?|partitions?).{0,20}\b(do i have|available|exist|are there)\b/i.test(text)
      || /\b(drives?|disks?|partitions?)\s+(in|on|of)\s+(my|this|the)\s+(system|computer|pc|machine)\b/i.test(text);
}
function detectFilesystemIntent(text) {
  const t = text.toLowerCase();
  if (/[a-z]:[\\\/]/i.test(text)) return true;               // explicit drive path: D:\, C:\
  if (/\b[a-z]\s*(drive|:)\b/i.test(t)) return true;         // "D drive", "D:"
  return (
    /(what|list|show|tell|see|check|open|explore|read|give).{0,25}(folder|file|director|inside|content|available)/i.test(t) ||
    /(folder|file|content|inside|what.{0,5}in).{0,20}(download|document|desktop|pictures?|music|video|drive|d:|c:)/i.test(t) ||
    /(download|document|desktop|pictures?|music|video).{0,20}(folder|file|content|list|inside|what|show|available)/i.test(t) ||
    /(inside|within|in\s+the).{0,20}(download|document|desktop|folder|directory)/i.test(t)
  );
}

// ── Resolve the target path from user text ───────────────────────────────────
async function resolveFsPath(text) {
  // 1. Explicit Windows path like D:\Projects or C:\Users\foo
  const pathMatch = text.match(/([a-z]:[\\\/][^\s,;?!'"]*)/i);
  if (pathMatch) {
    return pathMatch[1].replace(/\//g, '\\').replace(/\\+$/, '') || pathMatch[1];
  }

  // 2. Drive root: "D drive", "D:", "D:\"
  const driveMatch = text.match(/\b([a-z])\s*(?:drive|:)\s*(?:\\|\/)?(?:\s|$)/i);
  if (driveMatch) return driveMatch[1].toUpperCase() + ':\\';

  // 3. Named subfolder continuation — "inside downloads", "in the projects folder"
  const subMatch = text.match(/(?:inside|in|within|the\s+|open\s+|explore\s+)\s*(?:the\s+)?([A-Za-z][A-Za-z0-9 _-]{0,30})(?:\s+folder|\s+directory|\s+files?)?/i);
  if (subMatch) {
    const sub = subMatch[1].trim();
    if (!/^(a|the|my|your|this|that|what|which|folders?|files?|available|all|local|system)$/i.test(sub)) {
      // Try as subfolder of last accessed path first
      if (_lastFsPath) {
        const candidate = _lastFsPath + '\\' + sub;
        try {
          const r = await fetch('/api/filesystem', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'info', path: candidate })
          });
          const d = await r.json();
          if (d.success && d.info?.type === 'folder') return candidate;
        } catch(e) {}
      }
      // Try server-side common folder resolution
      try {
        const r = await fetch('/api/filesystem', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resolve', folderName: sub, path: sub })
        });
        const d = await r.json();
        if (d.success && d.path) return d.path;
      } catch(e) {}
    }
  }

  // 4. Common folder keywords anywhere in text
  const folderMap = {
    download: 'Downloads', document: 'Documents', desktop: 'Desktop',
    picture: 'Pictures',   photo: 'Pictures',     music: 'Music',
    video: 'Videos',       movie: 'Videos',
  };
  for (const [keyword, name] of Object.entries(folderMap)) {
    if (new RegExp(`\\b${keyword}`, 'i').test(text)) {
      // Use last drive context if available
      const lastDrive = _lastFsPath ? (_lastFsPath.match(/^([A-Za-z]:\\)/)?.[1] || null) : null;
      if (lastDrive) {
        const candidate = lastDrive + name;
        try {
          const r = await fetch('/api/filesystem', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'info', path: candidate })
          });
          const d = await r.json();
          if (d.success) return candidate;
        } catch(e) {}
      }
      // Fall back to home directory resolution
      try {
        const r = await fetch('/api/filesystem', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resolve', folderName: name.toLowerCase(), path: name })
        });
        const d = await r.json();
        if (d.success && d.path) return d.path;
      } catch(e) {}
    }
  }

  return null;
}

// ── Handle file detail query from last listing ────────────────────────────────
async function handleFileDetailQuery(text) {
  if (!_lastFsEntries.length) return false;

  // Detect "detail / info / more / about / size / date" for a filename
  if (!/\b(detail|info|more|about|size|date|when|type|what is|show|open|describe)\b/i.test(text)) return false;

  // Try to find a mentioned file name from the last listing
  const mentioned = _lastFsEntries.find(e =>
    text.toLowerCase().includes(e.name.toLowerCase()) ||
    (e.ext && text.toLowerCase().includes(e.ext.replace('.', '')))
  );

  if (!mentioned) return false;

  addMessage('user', text);
  setStatus('📄 READING FILE INFO...');

  try {
    const r = await fetch('/api/filesystem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'info', path: mentioned.fullPath })
    });
    const data = await r.json();
    setStatus('✓ SYSTEM ONLINE');

    if (!data.success) {
      addMessage('ai', `Couldn't get info for \`${mentioned.name}\`${isVerifiedBoss ? ', Boss' : ''}. ${data.error}`);
      return true;
    }

    const { info } = data;
    const boss = isVerifiedBoss ? ', Boss' : '';
    const reply =
      `📄 **${mentioned.name}**\n` +
      `**Path:** \`${mentioned.fullPath}\`\n` +
      `**Type:** ${info.type === 'file' ? (info.ext || 'file').replace('.','').toUpperCase() + ' file' : 'Folder'}\n` +
      `**Size:** ${info.sizeFmt || '0 B'}\n` +
      `**Created:** ${info.created}\n` +
      `**Modified:** ${info.modified}` +
      (boss ? `\n\nAnything else you need on this file${boss}?` : '');
    addMessage('ai', reply);
    return true;
  } catch(e) {
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `Error reading file info: ${e.message}`);
    return true;
  }
}

// ── Main filesystem command handler ──────────────────────────────────────────
async function handleFilesystemCommand(userText) {  // Drive listing intent
  if (detectDriveListIntent(userText)) {
    addMessage('user', userText);
    setStatus('💾 SCANNING DRIVES…');
    try {
      const r = await fetch('/api/filesystem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'drives' })
      });
      const d = await r.json();
      setStatus('✓ SYSTEM ONLINE');
      if (d.success && d.drives.length) {
        const boss = isVerifiedBoss ? ', Boss' : '';
        const rows = d.drives.map(dr => {
          const lbl = dr.label ? ` (${dr.label})` : '';
          const space = dr.total ? ` — ${dr.free} free / ${dr.total} total` : '';
          return `- **${dr.letter}:\\**${lbl}${space}`;
        }).join('\n');
        addMessage('ai', `💾 **Available Drives${boss}**\n\n${rows}\n\nSay “list D drive” or “show C:\\Users” to explore.`);
      } else {
        addMessage('ai', 'No drives found.');
      }
    } catch(e) {
      setStatus('✓ SYSTEM ONLINE');
      addMessage('ai', `Drive scan failed: ${e.message}`);
    }
    return true;
  }
  // First check if it's a file detail query on the last listing
  if (_lastFsEntries.length && await handleFileDetailQuery(userText)) return true;

  if (!detectFilesystemIntent(userText)) return false;

  const targetPath = await resolveFsPath(userText);
  if (!targetPath) return false;

  addMessage('user', userText);

  // Show scanning indicator
  const msgs = document.getElementById('messages');
  const scanDiv = document.createElement('div');
  scanDiv.className = 'msg ai'; scanDiv.id = 'fs_scan';
  scanDiv.innerHTML = `
    <div class="avatar ai">⬡</div>
    <div class="bubble ai">
      <div class="fs-scanning">
        <span class="fs-scan-spin">⟳</span>
        <span>Scanning <code>${targetPath}</code>…</span>
      </div>
    </div>`;
  msgs.appendChild(scanDiv);
  scrollToBottom();
  setStatus('📂 SCANNING FILESYSTEM...');

  try {
    const resp = await fetch('/api/filesystem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', path: targetPath })
    });
    const data = await resp.json();
    document.getElementById('fs_scan')?.remove();
    setStatus('✓ SYSTEM ONLINE');

    if (!data.success) {
      const boss = isVerifiedBoss ? ', Boss' : '';
      addMessage('ai', `I couldn't access \`${targetPath}\`${boss}. ${data.error}`);
      return true;
    }

    // Save context for follow-up questions
    _lastFsPath    = targetPath;
    _lastFsEntries = data.entries;

    // Build formatted response
    const folders = data.entries.filter(e => e.type === 'folder');
    const files   = data.entries.filter(e => e.type === 'file');
    const boss    = isVerifiedBoss ? ', Boss' : '';

    let reply = `📂 **${targetPath}**  —  ${data.total} item${data.total !== 1 ? 's' : ''}${boss}\n\n`;

    if (folders.length) {
      reply += `**📁 Folders (${folders.length}):**\n`;
      folders.forEach((f, i) => { reply += `${i + 1}. ${f.name}\n`; });
      reply += '\n';
    }

    if (files.length) {
      reply += `**📄 Files (${files.length}):**\n`;
      const shown = files.slice(0, 40);
      shown.forEach((f, i) => {
        const size = f.sizeFmt ? `  *(${f.sizeFmt})*` : '';
        reply += `${i + 1}. ${f.name}${size}\n`;
      });
      if (files.length > 40) reply += `_…and ${files.length - 40} more files_\n`;
    }

    if (!data.total) reply += '_This directory is empty._';

    addMessage('ai', reply.trim());
    return true;

  } catch(e) {
    document.getElementById('fs_scan')?.remove();
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `Filesystem scan failed: ${e.message}`);
    return true;
  }
}
