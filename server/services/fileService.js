'use strict';

const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);

const logger  = require('../utils/logger');
const { formatFileSize, buildDocChunks } = require('../utils/helpers');

// ─── Document Store (in-memory, keyed by docId) ───────────────────────────────

const documentStore = new Map();
const MAX_DOC_CHARS = 120000;

// ─── Hidden filesystem entries ────────────────────────────────────────────────

const HIDDEN_NAMES = new Set([
  '$RECYCLE.BIN', '$Recycle.Bin', 'System Volume Information',
  'Recovery', 'SYSTEM.SAV', 'hiberfil.sys', 'pagefile.sys', 'swapfile.sys',
  'desktop.ini', 'thumbs.db', '.DS_Store'
]);

// ─── Drives ───────────────────────────────────────────────────────────────────

async function getDrives() {
  const drives = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const p = letter + ':\\';
    try {
      fs.readdirSync(p);
      let label = '', total = '', free = '';
      try {
        const { stdout } = await execAsync(`wmic logicaldisk where name="${letter}:" get VolumeName,Size,FreeSpace /format:csv`, { timeout: 3000 });
        const lines = stdout.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
        if (lines[0]) {
          const parts = lines[0].split(',');
          free  = formatFileSize(parseInt(parts[1]) || 0);
          label = parts[2]?.trim() || '';
          total = formatFileSize(parseInt(parts[3]) || 0);
        }
      } catch (_) {}
      drives.push({ letter, path: p, label, total, free });
    } catch (_) {}
  }
  return drives;
}

// ─── Resolve Special Folders ──────────────────────────────────────────────────

function resolveSpecialFolder(folderName) {
  const home = os.homedir();
  const map  = {
    downloads: path.join(home, 'Downloads'),
    documents: path.join(home, 'Documents'),
    desktop:   path.join(home, 'Desktop'),
    pictures:  path.join(home, 'Pictures'),
    music:     path.join(home, 'Music'),
    videos:    path.join(home, 'Videos'),
    home:      home,
    appdata:   path.join(home, 'AppData')
  };
  const key      = (folderName || '').toLowerCase().replace(/s$/, '');
  const resolved = map[key] || map[key + 's'] || null;
  return { path: resolved, home };
}

// ─── List Directory ───────────────────────────────────────────────────────────

function listDirectory(dirPath) {
  const cleanPath = (dirPath || '').trim().replace(/\//g, '\\').replace(/\\+$/, '') || dirPath;
  const raw = fs.readdirSync(cleanPath, { withFileTypes: true });
  const entries = raw
    .filter(e => !HIDDEN_NAMES.has(e.name) && !e.name.startsWith('.'))
    .map(e => {
      try {
        const full = path.join(cleanPath, e.name);
        const stat = fs.statSync(full);
        return {
          name:     e.name,
          type:     e.isDirectory() ? 'folder' : 'file',
          size:     stat.size,
          sizeFmt:  formatFileSize(stat.size),
          modified: stat.mtime.toISOString().split('T')[0],
          ext:      e.isDirectory() ? null : path.extname(e.name).toLowerCase(),
          fullPath: full
        };
      } catch {
        return { name: e.name, type: e.isDirectory() ? 'folder' : 'file', size: 0, sizeFmt: '', modified: '', ext: null, fullPath: path.join(cleanPath, e.name) };
      }
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  return { path: cleanPath, entries, total: entries.length };
}

// ─── File Info ────────────────────────────────────────────────────────────────

function getFileInfo(filePath) {
  const cleanPath = (filePath || '').trim().replace(/\//g, '\\');
  const stat = fs.statSync(cleanPath);
  return {
    path:    cleanPath,
    name:    path.basename(cleanPath),
    type:    stat.isDirectory() ? 'folder' : 'file',
    size:    stat.size,
    sizeFmt: formatFileSize(stat.size),
    created: stat.birthtime.toISOString().split('T')[0],
    modified: stat.mtime.toISOString().split('T')[0],
    ext:     path.extname(cleanPath).toLowerCase() || null
  };
}

// ─── Codebase Context Scanner ─────────────────────────────────────────────────

function getCodebaseContext() {
  const jsDir  = path.join(__dirname, '..', '..', 'public', 'js');
  const cssDir = path.join(__dirname, '..', '..', 'public', 'css');
  let ctx = '=== JARVIS CODEBASE CONTEXT ===\n\nFrontend JS files and their global functions:\n';
  try {
    const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
    for (const file of jsFiles) {
      const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
      const fns  = [...content.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)].map(m => m[1]);
      const vars = [...content.matchAll(/^(?:let|const|var)\s+(\w+)/gm)].map(m => m[1]).slice(0, 6);
      ctx += `  ${file}:\n`;
      if (fns.length)  ctx += `    functions: ${fns.slice(0, 12).join(', ')}\n`;
      if (vars.length) ctx += `    globals:   ${vars.join(', ')}\n`;
    }
  } catch (_) { ctx += '  (could not read js/)\n'; }
  ctx += '\nCSS files: ';
  try {
    const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
    ctx += cssFiles.join(', ') + '\n';
  } catch (_) { ctx += '(unknown)\n'; }
  const customJs = path.join(jsDir, 'custom-features.js');
  if (fs.existsSync(customJs)) {
    const content = fs.readFileSync(customJs, 'utf8');
    const applied = [...content.matchAll(/AUTO-FEATURE:\s*([^\n(]+)/g)].map(m => m[1].trim());
    if (applied.length) ctx += `\nAlready-applied custom features: ${applied.join(', ')}\n`;
  }
  ctx += '\nKey DOM elements: #messages, #userInput, #chatArea, .sidebar, header, #devModal\n';
  ctx += 'Key state globals: currentMode, currentLanguage, userProfile, conversationHistory, isLoading\n';
  ctx += '================================\n';
  return ctx;
}

// ─── Apply Feature (writes code to project files) ────────────────────────────

function applyFeature({ js, css, html, type, featureName }) {
  if (!featureName) throw new Error('Missing featureName');
  const ROOT       = path.join(__dirname, '..', '..');
  const indexPath  = path.join(ROOT, 'public', 'index.html');
  const serverPath = path.join(ROOT, 'server.js');
  const customJsPath  = path.join(ROOT, 'public', 'js', 'custom-features.js');
  const customCssPath = path.join(ROOT, 'public', 'css', 'custom-features.css');
  const ts    = Date.now();
  const stamp = new Date().toISOString();
  const strip = s => (s || '').replace(/```[\w]*\n?/g, '').replace(/```\n?/g, '').trim();
  const jsCode  = strip(js);
  const cssCode = strip(css);
  const htmlCode = strip(html);

  if (type === 'api') {
    let content = fs.readFileSync(serverPath, 'utf8');
    const marker = '// ✅ Start server';
    if (!content.includes(marker)) throw new Error('Cannot locate insertion marker in server.js');
    fs.writeFileSync(serverPath + '.bak.' + ts, content, 'utf8');
    const block = `\n// ─── AUTO-FEATURE: ${featureName} (${stamp}) ───\n${jsCode}\n\n`;
    fs.writeFileSync(serverPath, content.replace(marker, block + marker), 'utf8');
    return { file: 'server.js', requiresRestart: true, message: `"${featureName}" injected into server.js. Restart the server to activate.` };
  }

  const section = `\n// ═══ AUTO-FEATURE: ${featureName} (${stamp}) ═══\n`;
  if (jsCode)  fs.appendFileSync(customJsPath, section + jsCode + '\n', 'utf8');
  if (cssCode) fs.appendFileSync(customCssPath, `\n/* ═══ AUTO-FEATURE: ${featureName} (${stamp}) ═══ */\n` + cssCode + '\n', 'utf8');

  let indexContent = fs.readFileSync(indexPath, 'utf8');
  let indexChanged = false;
  if (cssCode && !indexContent.includes('css/custom-features.css')) {
    indexContent = indexContent.replace('</head>', '  <link rel="stylesheet" href="css/custom-features.css"/>\n</head>');
    indexChanged = true;
  }
  if ((jsCode || htmlCode) && !indexContent.includes('js/custom-features.js')) {
    indexContent = indexContent.replace('</body>', '<script src="js/custom-features.js"></script>\n</body>');
    indexChanged = true;
  }
  if (htmlCode) {
    indexContent = indexContent.replace('</body>', `<!-- AUTO-FEATURE: ${featureName} -->\n${htmlCode}\n</body>`);
    indexChanged = true;
  }
  if (indexChanged) {
    fs.writeFileSync(indexPath + '.bak.' + ts, fs.readFileSync(indexPath, 'utf8'), 'utf8');
    fs.writeFileSync(indexPath, indexContent, 'utf8');
  }

  const files = [jsCode && 'custom-features.js', cssCode && 'custom-features.css'].filter(Boolean).join(' + ') || 'custom-features.js';
  return { file: files, requiresReload: true, message: `"${featureName}" applied. Reload the page to use the new feature.` };
}

// ─── Document Upload & Parse ─────────────────────────────────────────────────

const SUPPORTED_EXTS = new Set(['pdf','docx','txt','md','csv','json','xml','html','js','java','py','ts','cs','cpp','c','rb','go','rs','kt','swift']);

async function uploadDocument(file) {
  const { originalname, buffer, mimetype } = file;
  const ext = originalname.split('.').pop().toLowerCase().replace(/[^a-z]/g, '');
  if (!SUPPORTED_EXTS.has(ext)) throw new Error(`Unsupported file type: .${ext}`);

  let text = '';

  if (ext === 'pdf') {
    const pdfParsePkg = require('pdf-parse');
    const PDFParse = pdfParsePkg.PDFParse || pdfParsePkg.default?.PDFParse || pdfParsePkg.default;
    if (typeof PDFParse !== 'function') throw new Error('PDF parser module did not expose PDFParse');
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      text = parsed?.text || '';
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else if (ext === 'docx') {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ buffer });
    text = result.value || '';
  } else {
    text = buffer.toString('utf8');
  }

  text = text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim();
  let truncated = false;
  if (text.length > MAX_DOC_CHARS) {
    text = text.slice(0, MAX_DOC_CHARS);
    const lastNL = text.lastIndexOf('\n');
    if (lastNL > MAX_DOC_CHARS * 0.9) text = text.slice(0, lastNL);
    truncated = true;
  }

  const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  documentStore.set(docId, {
    id: docId, name: originalname, ext, text,
    chunks:    buildDocChunks(text),
    charCount: text.length, truncated,
    uploadedAt: new Date().toISOString()
  });

  logger.info(`Document uploaded: "${originalname}" — ${text.length} chars${truncated ? ' (truncated)' : ''}`);

  return {
    docId, name: originalname, charCount: text.length, truncated,
    preview: text.slice(0, 400).replace(/\s+/g, ' ').trim() + (text.length > 400 ? '…' : '')
  };
}

function getDocuments() {
  return [...documentStore.values()].map(({ id, name, ext, charCount, truncated, uploadedAt }) =>
    ({ id, name, ext, charCount, truncated, uploadedAt })
  );
}

function deleteDocument(id) {
  return documentStore.delete(id);
}

module.exports = {
  documentStore,
  getDrives, resolveSpecialFolder, listDirectory, getFileInfo,
  getCodebaseContext, applyFeature,
  uploadDocument, getDocuments, deleteDocument,
  SUPPORTED_EXTS
};
