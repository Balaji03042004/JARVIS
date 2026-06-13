'use strict';

const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { exec, spawn } = require('child_process');
const { promisify }   = require('util');
const execAsync = promisify(exec);

const logger = require('../utils/logger');
const { formatFileSize, fmtUptime } = require('../utils/helpers');

// ─── Blocked Commands (safety) ────────────────────────────────────────────────

const BLOCKED_CMD_RE = [
  /\bformat\b\s+[a-z]:/i,
  /\bshutdown\b/i, /\brestart\b/i,
  /\bdel\s+\/[sqf]/i, /\brmdir\s+\/s/i, /\brd\s+\/s/i,
  /\brm\s+-rf?\b/i,
  /\bregdel\b/i, /\breg\s+delete\b/i,
  /\bnetsh\s+(firewall|advfirewall)\s+(set|delete)/i,
  /\bnet\s+(user|localgroup)\b/i,
];

// ─── App Map (built-in + common installed apps) ──────────────────────────────
// Format: alias → { exe: 'name or path', paths: ['fallback paths'] }

const HOME = os.homedir();

const APP_MAP = {
  // ── Windows built-ins ──────────────────────────────────────────────────
  'notepad':                 { exe: 'notepad.exe',        paths: [] },
  'note pad':                { exe: 'notepad.exe',        paths: [] },
  'notepad++':               { exe: 'notepad++.exe',      paths: ['C:\\Program Files\\Notepad++\\notepad++.exe','C:\\Program Files (x86)\\Notepad++\\notepad++.exe'] },
  'calculator':              { exe: 'calc.exe',           paths: [] },
  'calc':                    { exe: 'calc.exe',           paths: [] },
  'paint':                   { exe: 'mspaint.exe',        paths: [] },
  'ms paint':                { exe: 'mspaint.exe',        paths: [] },
  'wordpad':                 { exe: 'wordpad.exe',        paths: [] },
  'explorer':                { exe: 'explorer.exe',       paths: [] },
  'file explorer':           { exe: 'explorer.exe',       paths: [] },
  'my computer':             { exe: 'explorer.exe',       paths: [] },
  'task manager':            { exe: 'taskmgr.exe',        paths: [] },
  'taskmgr':                 { exe: 'taskmgr.exe',        paths: [] },
  'control panel':           { exe: 'control.exe',        paths: [] },
  'cmd':                     { exe: 'cmd.exe',            paths: [] },
  'command prompt':          { exe: 'cmd.exe',            paths: [] },
  'powershell':              { exe: 'powershell.exe',     paths: [] },
  'registry':                { exe: 'regedit.exe',        paths: [] },
  'regedit':                 { exe: 'regedit.exe',        paths: [] },
  'device manager':          { exe: 'devmgmt.msc',        paths: [] },
  'disk management':         { exe: 'diskmgmt.msc',       paths: [] },
  'event viewer':            { exe: 'eventvwr.msc',       paths: [] },
  'services':                { exe: 'services.msc',       paths: [] },
  'snipping tool':           { exe: 'SnippingTool.exe',   paths: [] },
  'snip':                    { exe: 'SnippingTool.exe',   paths: [] },
  'clipboard':               { exe: 'ms-settings:clipboard', paths: [] },
  'clock':                   { exe: 'ms-clock:',          paths: [] },
  'settings':                { exe: 'ms-settings:',       paths: [] },
  'windows settings':        { exe: 'ms-settings:',       paths: [] },
  'camera':                  { exe: 'microsoft.windows.camera:', paths: [] },

  // ── Browsers ────────────────────────────────────────────────────────────
  'chrome':                  { exe: 'chrome', paths: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'] },
  'google chrome':           { exe: 'chrome', paths: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'] },
  'firefox':                 { exe: 'firefox', paths: ['C:\\Program Files\\Mozilla Firefox\\firefox.exe'] },
  'mozilla firefox':         { exe: 'firefox', paths: ['C:\\Program Files\\Mozilla Firefox\\firefox.exe'] },
  'edge':                    { exe: 'msedge', paths: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'] },
  'microsoft edge':          { exe: 'msedge', paths: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'] },
  'brave':                   { exe: 'brave',  paths: [`${HOME}\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'] },
  'opera':                   { exe: 'opera',  paths: [`${HOME}\\AppData\\Local\\Programs\\Opera\\opera.exe`] },
  'vivaldi':                 { exe: 'vivaldi',paths: ['C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe'] },
  'tor':                     { exe: 'tor browser', paths: [`${HOME}\\Desktop\\Tor Browser\\Browser\\firefox.exe`] },

  // ── Code Editors / IDEs ─────────────────────────────────────────────────
  'vscode':                  { exe: 'code', paths: [] },
  'vs code':                 { exe: 'code', paths: [] },
  'visual studio code':      { exe: 'code', paths: [] },
  'visual studio':           { exe: 'devenv', paths: ['C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\devenv.exe','C:\\Program Files\\Microsoft Visual Studio\\2019\\Community\\Common7\\IDE\\devenv.exe'] },
  'intellij':                { exe: 'idea64', paths: [`${HOME}\\AppData\\Local\\JetBrains\\Toolbox\\apps\\IDEA-U\\ch-0\\idea64.exe`,'C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe'] },
  'intellij idea':           { exe: 'idea64', paths: ['C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe'] },
  'pycharm':                 { exe: 'pycharm64', paths: ['C:\\Program Files\\JetBrains\\PyCharm\\bin\\pycharm64.exe'] },
  'webstorm':                { exe: 'webstorm64', paths: ['C:\\Program Files\\JetBrains\\WebStorm\\bin\\webstorm64.exe'] },
  'android studio':          { exe: 'studio64', paths: ['C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe',`${HOME}\\AppData\\Local\\Android\\Sdk\\tools\\bin\\studio64.exe`] },
  'eclipse':                 { exe: 'eclipse', paths: ['C:\\eclipse\\eclipse.exe',`${HOME}\\eclipse\\eclipse.exe`] },
  'sublime':                 { exe: 'sublime_text', paths: ['C:\\Program Files\\Sublime Text\\sublime_text.exe','C:\\Program Files\\Sublime Text 3\\sublime_text.exe'] },
  'sublime text':            { exe: 'sublime_text', paths: ['C:\\Program Files\\Sublime Text\\sublime_text.exe'] },
  'atom':                    { exe: 'atom', paths: [`${HOME}\\AppData\\Local\\atom\\atom.exe`] },
  'brackets':                { exe: 'brackets', paths: ['C:\\Program Files\\Brackets\\Brackets.exe'] },
  'cursor':                  { exe: 'cursor', paths: [`${HOME}\\AppData\\Local\\Programs\\cursor\\Cursor.exe`] },

  // ── Communication ───────────────────────────────────────────────────────
  'teams':                   { exe: 'teams', paths: [`${HOME}\\AppData\\Local\\Microsoft\\Teams\\current\\Teams.exe`,`${HOME}\\AppData\\Local\\Microsoft\\Teams\\Update.exe`] },
  'microsoft teams':         { exe: 'teams', paths: [`${HOME}\\AppData\\Local\\Microsoft\\Teams\\current\\Teams.exe`] },
  'zoom':                    { exe: 'zoom', paths: [`${HOME}\\AppData\\Roaming\\Zoom\\bin\\zoom.exe`,'C:\\Program Files\\Zoom\\bin\\Zoom.exe'] },
  'slack':                   { exe: 'slack', paths: [`${HOME}\\AppData\\Local\\slack\\slack.exe`] },
  'discord':                 { exe: 'discord', paths: [`${HOME}\\AppData\\Local\\Discord\\app-*\\Discord.exe`,`${HOME}\\AppData\\Local\\Discord\\Discord.exe`] },
  'whatsapp':                { exe: 'whatsapp', paths: [`${HOME}\\AppData\\Local\\WhatsApp\\WhatsApp.exe`,'C:\\Program Files\\WindowsApps\\WhatsApp.exe'] },
  'telegram':                { exe: 'telegram', paths: [`${HOME}\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe`] },
  'skype':                   { exe: 'skype', paths: [`${HOME}\\AppData\\Roaming\\Microsoft\\Skype\\skype.exe`] },
  'outlook':                 { exe: 'outlook', paths: [] },
  'thunderbird':             { exe: 'thunderbird', paths: ['C:\\Program Files\\Mozilla Thunderbird\\thunderbird.exe'] },

  // ── Office ──────────────────────────────────────────────────────────────
  'word':                    { exe: 'winword', paths: [] },
  'microsoft word':          { exe: 'winword', paths: [] },
  'excel':                   { exe: 'excel', paths: [] },
  'microsoft excel':         { exe: 'excel', paths: [] },
  'powerpoint':              { exe: 'powerpnt', paths: [] },
  'microsoft powerpoint':    { exe: 'powerpnt', paths: [] },
  'onenote':                 { exe: 'onenote', paths: [] },
  'access':                  { exe: 'msaccess', paths: [] },
  'libreoffice':             { exe: 'soffice', paths: ['C:\\Program Files\\LibreOffice\\program\\soffice.exe'] },

  // ── Media ───────────────────────────────────────────────────────────────
  'vlc':                     { exe: 'vlc', paths: ['C:\\Program Files\\VideoLAN\\VLC\\vlc.exe','C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'] },
  'spotify':                 { exe: 'spotify', paths: [`${HOME}\\AppData\\Roaming\\Spotify\\Spotify.exe`] },
  'media player':            { exe: 'wmplayer', paths: [] },
  'windows media player':    { exe: 'wmplayer', paths: [] },
  'itunes':                  { exe: 'itunes', paths: ['C:\\Program Files\\iTunes\\iTunes.exe'] },
  'audacity':                { exe: 'audacity', paths: ['C:\\Program Files\\Audacity\\audacity.exe'] },
  'obs':                     { exe: 'obs64', paths: ['C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'] },
  'obs studio':              { exe: 'obs64', paths: ['C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'] },
  'potplayer':               { exe: 'potplayermini64', paths: ['C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe'] },

  // ── Dev Tools ───────────────────────────────────────────────────────────
  'git bash':                { exe: 'git-bash', paths: ['C:\\Program Files\\Git\\git-bash.exe'] },
  'git':                     { exe: 'git-bash', paths: ['C:\\Program Files\\Git\\git-bash.exe'] },
  'postman':                 { exe: 'postman', paths: [`${HOME}\\AppData\\Local\\Postman\\app-*\\Postman.exe`,`${HOME}\\AppData\\Local\\Postman\\Postman.exe`] },
  'dbeaver':                 { exe: 'dbeaver', paths: ['C:\\Program Files\\DBeaver\\dbeaver.exe'] },
  'mongodb compass':         { exe: 'MongoDBCompass', paths: [`${HOME}\\AppData\\Local\\MongoDBCompass\\MongoDBCompass.exe`,'C:\\Program Files\\MongoDB Compass\\MongoDBCompass.exe'] },
  'compass':                 { exe: 'MongoDBCompass', paths: [`${HOME}\\AppData\\Local\\MongoDBCompass\\MongoDBCompass.exe`] },
  'docker':                  { exe: 'docker desktop', paths: ['C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'] },
  'docker desktop':          { exe: 'docker desktop', paths: ['C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'] },
  'filezilla':               { exe: 'filezilla', paths: ['C:\\Program Files\\FileZilla FTP Client\\filezilla.exe'] },
  'putty':                   { exe: 'putty', paths: ['C:\\Program Files\\PuTTY\\putty.exe'] },
  'winscp':                  { exe: 'winscp', paths: ['C:\\Program Files (x86)\\WinSCP\\WinSCP.exe'] },
  'wireshark':               { exe: 'wireshark', paths: ['C:\\Program Files\\Wireshark\\Wireshark.exe'] },
  'insomnia':                { exe: 'insomnia', paths: [`${HOME}\\AppData\\Local\\insomnia\\insomnia.exe`] },

  // ── Utilities ───────────────────────────────────────────────────────────
  '7zip':                    { exe: '7zfm', paths: ['C:\\Program Files\\7-Zip\\7zFM.exe'] },
  '7-zip':                   { exe: '7zfm', paths: ['C:\\Program Files\\7-Zip\\7zFM.exe'] },
  'winrar':                  { exe: 'winrar', paths: ['C:\\Program Files\\WinRAR\\WinRAR.exe'] },
  'winzip':                  { exe: 'winzip32', paths: ['C:\\Program Files\\WinZip\\winzip32.exe'] },
  'everything':              { exe: 'everything', paths: ['C:\\Program Files\\Everything\\Everything.exe'] },
  'ccleaner':                { exe: 'ccleaner', paths: ['C:\\Program Files\\CCleaner\\CCleaner64.exe'] },
  'teamviewer':              { exe: 'teamviewer', paths: ['C:\\Program Files\\TeamViewer\\TeamViewer.exe'] },
  'anydesk':                 { exe: 'anydesk', paths: ['C:\\Program Files (x86)\\AnyDesk\\AnyDesk.exe'] },
  'keepass':                 { exe: 'keepass', paths: ['C:\\Program Files\\KeePass Password Safe 2\\KeePass.exe'] },
  'bitwarden':               { exe: 'bitwarden', paths: [`${HOME}\\AppData\\Local\\Programs\\Bitwarden\\Bitwarden.exe`] },
  'virtualbox':              { exe: 'virtualbox', paths: ['C:\\Program Files\\Oracle\\VirtualBox\\VirtualBox.exe'] },
  'vmware':                  { exe: 'vmware', paths: ['C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmware.exe'] },
  'notion':                  { exe: 'notion', paths: [`${HOME}\\AppData\\Local\\Programs\\Notion\\Notion.exe`] },
  'obsidian':                { exe: 'obsidian', paths: [`${HOME}\\AppData\\Local\\Obsidian\\Obsidian.exe`] },
  'evernote':                { exe: 'evernote', paths: [`${HOME}\\AppData\\Local\\Programs\\Evernote\\evernote.exe`] },
  'onenote':                 { exe: 'onenote', paths: [] },
  'todoist':                 { exe: 'todoist', paths: [`${HOME}\\AppData\\Local\\Programs\\Todoist\\Todoist.exe`] },
  'figma':                   { exe: 'figma', paths: [`${HOME}\\AppData\\Local\\figma\\Figma.exe`] },
  'adobe photoshop':         { exe: 'photoshop', paths: ['C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe'] },
  'photoshop':               { exe: 'photoshop', paths: ['C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe','C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe'] },
  'illustrator':             { exe: 'illustrator', paths: ['C:\\Program Files\\Adobe\\Adobe Illustrator 2024\\Support Files\\Contents\\Windows\\Illustrator.exe'] },
  'premiere':                { exe: 'premiere pro', paths: ['C:\\Program Files\\Adobe\\Adobe Premiere Pro 2024\\Adobe Premiere Pro.exe'] },
  'after effects':           { exe: 'afterfx', paths: ['C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\AfterFX.exe'] },
  'acrobat':                 { exe: 'acrobat', paths: ['C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe'] },
  'pdf reader':              { exe: 'acrord32', paths: ['C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe'] },
  'gimp':                    { exe: 'gimp', paths: ['C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe'] },
  'inkscape':                { exe: 'inkscape', paths: ['C:\\Program Files\\Inkscape\\bin\\inkscape.exe'] },
  'blender':                 { exe: 'blender', paths: ['C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe'] },
};

// ─── Close Process Map ────────────────────────────────────────────────────────

const CLOSE_PROCESS_MAP = {
  'notepad': ['notepad'], 'notepad++': ['notepad++'], 'calculator': ['calculator','calc'],
  'paint': ['mspaint'], 'chrome': ['chrome'], 'google chrome': ['chrome'],
  'firefox': ['firefox'], 'edge': ['msedge'], 'microsoft edge': ['msedge'],
  'spotify': ['spotify'], 'vlc': ['vlc'], 'vscode': ['code'], 'vs code': ['code'],
  'visual studio code': ['code'], 'teams': ['teams','ms-teams'],
  'zoom': ['zoom'], 'word': ['winword'], 'excel': ['excel'],
  'powerpoint': ['powerpnt'], 'outlook': ['outlook'],
  'explorer': ['explorer'], 'cmd': ['cmd'], 'powershell': ['powershell','pwsh'],
  'task manager': ['taskmgr'], 'snipping tool': ['snippingtool'],
  'whatsapp': ['whatsapp','whatsappdesktop'], 'telegram': ['telegram'],
  'discord': ['discord'], 'slack': ['slack'],
};

const BROWSER_PROCESS_MAP = {
  'chrome': 'chrome', 'google chrome': 'chrome',
  'firefox': 'firefox', 'edge': 'msedge', 'browser': null
};

// ─── In-Memory App Cache ──────────────────────────────────────────────────────

let _scannedApps = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeCmdArg(value) {
  return String(value || '').replace(/"/g, '""').trim();
}

function normalizeAppKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9.+#\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksLikeUrlOrDomain(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return false;
  if (/^https?:\/\//.test(s)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/.test(s);
}

function looksLikeWindowsPath(value) {
  const s = String(value || '').trim();
  return /^[a-z]:\\/i.test(s) || /^\\\\/.test(s);
}

function spawnDetached(target) {
  exec(`start "" "${target}"`, (err) => {
    if (err) logger.warn('Launch error: ' + err.message);
  });
}

async function launchViaStart(target) {
  const safe = escapeCmdArg(target);
  if (!safe) throw new Error('Empty launch target');
  await execAsync(`cmd.exe /c start "" "${safe}"`, { timeout: 5000 });
}

// ─── EXE Deep Search ──────────────────────────────────────────────────────────
// Recursively searches common install directories for a matching .exe
// Max depth 4 to avoid scanning the entire drive

const EXE_SEARCH_DIRS = [
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  path.join(HOME, 'AppData\\Local\\Programs'),
  path.join(HOME, 'AppData\\Roaming'),
  path.join(HOME, 'AppData\\Local'),
  'C:\\tools',
  'C:\\dev',
];

function _deepFindExe(query, dir, depth = 0) {
  if (depth > 3) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith('.exe')) {
      const nameNoExt = e.name.slice(0, -4).toLowerCase();
      if (nameNoExt.includes(query) || query.includes(nameNoExt)) return full;
    } else if (e.isDirectory() && !['windows','system32','syswow64','installer','$recycle.bin'].includes(e.name.toLowerCase())) {
      const found = _deepFindExe(query, full, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function findExeOnDisk(appName) {
  const q = appName.toLowerCase().replace(/\s+/g, '');
  for (const dir of EXE_SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const found = _deepFindExe(q, dir, 0);
    if (found) return found;
  }
  return null;
}

// ─── System Info ──────────────────────────────────────────────────────────────

function getSystemInfo() {
  const cpus  = os.cpus();
  const total = os.totalmem(), free = os.freemem(), used = total - free;
  return {
    hostname:    os.hostname(), platform: os.platform(), arch: os.arch(),
    osRelease:   `${os.type()} ${os.release()}`,
    cpu:         cpus[0]?.model || 'Unknown', cpuCores: cpus.length,
    totalMemory: formatFileSize(total), freeMemory: formatFileSize(free),
    usedMemory:  formatFileSize(used), memPct: Math.round((used / total) * 100),
    uptime:      fmtUptime(os.uptime()), homeDir: os.homedir(),
    tmpDir:      os.tmpdir(), nodeVersion: process.version,
    serverCwd:   process.cwd(),
    now:         new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  };
}

// ─── Shell Command Execution ──────────────────────────────────────────────────

async function executeShellCommand(command, shell = 'cmd') {
  const safeCommand = String(command || '').trim();
  if (!safeCommand) return { success: false, error: 'No command provided' };
  if (BLOCKED_CMD_RE.some(r => r.test(safeCommand))) {
    logger.warn(`Blocked command: ${safeCommand}`);
    return { success: false, error: 'That command is blocked for safety.' };
  }
  const fullCmd = shell === 'powershell'
    ? `cmd /c powershell -NoProfile -Command "${safeCommand.replace(/"/g, '\\"')}"`
    : `cmd /c ${safeCommand}`;
  try {
    const { stdout, stderr } = await execAsync(fullCmd, { timeout: 20000, cwd: os.homedir() });
    return { success: true, stdout: (stdout || '').trim().slice(0, 4000), stderr: (stderr || '').trim().slice(0, 1000), command: safeCommand };
  } catch (e) {
    return { success: false, error: e.message, stdout: (e.stdout || '').trim().slice(0, 2000), stderr: (e.stderr || '').trim().slice(0, 1000), command: safeCommand };
  }
}

// ─── App Scanning ─────────────────────────────────────────────────────────────

function _walkLnk(dir, depth, results) {
  if (depth > 4) return;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { _walkLnk(full, depth + 1, results); }
      else if (e.name.toLowerCase().endsWith('.lnk')) {
        const name = e.name.slice(0, -4);
        if (!name.toLowerCase().includes('uninstall')) {
          results.push({ name, nameLower: name.toLowerCase(), lnkPath: full });
        }
      }
    }
  } catch (_) {}
}

function _scanStartMenu() {
  const dirs = [
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
    path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(os.homedir(), 'Desktop'),
    'C:\\Users\\Public\\Desktop',
  ];
  const results = [];
  for (const d of dirs) { if (fs.existsSync(d)) _walkLnk(d, 0, results); }
  const seen = new Set();
  return results.filter(a => { if (seen.has(a.nameLower)) return false; seen.add(a.nameLower); return true; });
}

async function getScannedApps(forceRefresh = false) {
  if (!_scannedApps || forceRefresh) {
    _scannedApps = _scanStartMenu();
    logger.info(`App scan: ${_scannedApps.length} apps found`);
  }
  return _scannedApps;
}

function fuzzyFindApp(apps, query) {
  const q = normalizeAppKey(query);
  if (!q) return null;
  let m = apps.find(a => a.nameLower === q);
  if (m) return m;
  m = apps.find(a => a.nameLower.startsWith(q));
  if (m) return m;
  m = apps.find(a => a.nameLower.includes(q));
  if (m) return m;
  const words = q.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 1) {
    m = apps.find(a => words.every(w => a.nameLower.includes(w)));
    if (m) return m;
  }
  m = apps.find(a => words.some(w => a.nameLower.startsWith(w)));
  return m || null;
}

// ─── App Launcher ─────────────────────────────────────────────────────────────

async function tryLaunchApp(entry, displayName) {
  const { exe, paths } = entry;
  if (exe.startsWith('ms-')) { exec(`start ${exe}`); return { success: true }; }
  let launchPath = null;
  try {
    const { stdout } = await execAsync(`where.exe "${exe}"`, { timeout: 3000 });
    launchPath = stdout.trim().split(/\r?\n/)[0].trim();
  } catch (_) {}
  if (!launchPath) {
    for (const p of (paths || [])) { if (fs.existsSync(p)) { launchPath = p; break; } }
  }
  if (!launchPath) return { success: false, error: `"${displayName}" is not installed.` };
  spawnDetached(launchPath);
  await new Promise(r => setTimeout(r, 500));
  return { success: true };
}

async function openInBrowser(url, preferChrome = false) {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) return { success: false, error: 'No URL provided' };
  if (!/^https?:\/\//i.test(targetUrl)) return { success: false, error: 'Invalid URL' };
  logger.info(`Browse: ${targetUrl}`);
  if (preferChrome) {
    let chromePath = null;
    try { const { stdout } = await execAsync('where.exe chrome', { timeout: 2000 }); chromePath = stdout.trim().split(/\r?\n/)[0].trim(); } catch (_) {}
    if (!chromePath) {
      for (const p of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']) {
        if (fs.existsSync(p)) { chromePath = p; break; }
      }
    }
    if (chromePath) {
      exec(`"${chromePath}" "${targetUrl}"`, err => { if (err) logger.warn('Chrome error: ' + err.message); });
      return { success: true, url: targetUrl, openedWith: 'Chrome' };
    }
  }
  exec(`start "" "${targetUrl}"`, err => { if (err) logger.warn('Browse error: ' + err.message); });
  await new Promise(r => setTimeout(r, 300));
  return { success: true, url: targetUrl, openedWith: 'default browser' };
}

async function openAnyAppTarget(appName) {
  const raw = String(appName || '').trim();
  if (!raw) return { success: false, error: 'No app name provided' };
  const key = normalizeAppKey(raw);

  // Layer 1 — URL or domain
  if (looksLikeUrlOrDomain(raw)) {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try { await launchViaStart(url); return { success: true, opened: url, kind: 'web' }; } catch (e) {}
  }

  // Layer 2 — Full Windows path
  if (looksLikeWindowsPath(raw) && fs.existsSync(raw)) {
    try { await launchViaStart(raw); return { success: true, opened: path.basename(raw), kind: 'path' }; } catch (e) {}
  }

  // Layer 3 — APP_MAP alias (built-in + 80+ common apps)
  const entry = APP_MAP[key];
  if (entry) {
    const r = await tryLaunchApp(entry, raw);
    if (r.success) return { success: true, opened: raw, kind: 'alias' };
  }

  // Layer 4 — Partial alias match (e.g. "intellij" matches "intellij idea")
  const partialEntry = Object.entries(APP_MAP).find(([k]) => k.includes(key) || key.includes(k));
  if (partialEntry) {
    const r = await tryLaunchApp(partialEntry[1], raw);
    if (r.success) return { success: true, opened: raw, kind: 'partial-alias' };
  }

  // Layer 5 — Start Menu / Desktop shortcuts scan
  try {
    const apps  = await getScannedApps();
    const match = fuzzyFindApp(apps, key);
    if (match) {
      spawnDetached(match.lnkPath);
      await new Promise(r => setTimeout(r, 500));
      return { success: true, opened: match.name, kind: 'shortcut' };
    }
  } catch (e) {}

  // Layer 6 — System PATH lookup (where.exe)
  try {
    const exeName = key.endsWith('.exe') ? key : key.replace(/\s+/g, '') + '.exe';
    const { stdout } = await execAsync(`where.exe "${exeName}"`, { timeout: 3000 });
    const found = stdout.trim().split(/\r?\n/)[0].trim();
    if (found && fs.existsSync(found)) {
      spawnDetached(found);
      return { success: true, opened: raw, kind: 'path-env' };
    }
  } catch (_) {}

  // Layer 7 — Deep EXE search in common install folders
  try {
    const exePath = await findExeOnDisk(key);
    if (exePath) {
      spawnDetached(exePath);
      logger.info(`Deep-found: ${exePath}`);
      return { success: true, opened: path.basename(exePath), kind: 'deep-search', path: exePath };
    }
  } catch (_) {}

  // Layer 8 — Windows "start" command (works for many apps in PATH or registered)
  try {
    const startName = key.replace(/\s+/g, '');
    await execAsync(`cmd.exe /c start ${startName}`, { timeout: 4000 });
    return { success: true, opened: raw, kind: 'start-cmd' };
  } catch (_) {}

  return { success: false, error: `"${raw}" wasn't found. Try saying the exact app name or say "list my apps".` };
}

// ─── Close App ────────────────────────────────────────────────────────────────

async function _closeByProcessName(exeNames, force) {
  let totalClosed = 0;
  for (const name of exeNames) {
    const safeExe = name.replace(/[^\w\-+#]/g, '');
    if (!safeExe) continue;
    const flag = force ? '/F ' : '';
    try {
      const { stdout: tl } = await execAsync(`cmd /c tasklist /FI "IMAGENAME eq ${safeExe}.exe" /FO CSV /NH`, { timeout: 4000 });
      const running = String(tl).split('\n').filter(l => l.toLowerCase().includes(`"${safeExe.toLowerCase()}.exe"`));
      if (running.length > 0) {
        await execAsync(`cmd /c taskkill ${flag}/IM "${safeExe}.exe"`, { timeout: 6000 });
        totalClosed += running.length;
      }
    } catch (_) {}
  }
  return totalClosed;
}

async function _closeByWindowTitle(titleKeyword, browserProc, force) {
  const safeTitle = String(titleKeyword || '').replace(/["%]/g, '').trim();
  if (!safeTitle) return 0;
  const flag = force ? '/F ' : '';
  let closed = 0;
  const cmds = [];
  if (browserProc) cmds.push(`cmd /c taskkill ${flag}/FI "IMAGENAME eq ${browserProc}.exe" /FI "WINDOWTITLE eq ${safeTitle}"`);
  cmds.push(`cmd /c taskkill ${flag}/FI "WINDOWTITLE eq ${safeTitle}"`);
  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 6000 });
      const hits = (String(stdout || '').match(/SUCCESS|process with/gi) || []).length;
      if (hits > 0) { closed += hits; break; }
    } catch (_) {}
  }
  return closed;
}

async function closeApp(target, browser, force = false) {
  if (!target) return { success: false, error: 'No target provided' };
  const key = normalizeAppKey(target);
  const forceFlag = !!force;

  if (!browser && CLOSE_PROCESS_MAP[key]) {
    const count = await _closeByProcessName(CLOSE_PROCESS_MAP[key], forceFlag);
    if (count > 0) return { success: true, closed: target, count, method: 'process' };
  }

  const browserProc = browser ? (BROWSER_PROCESS_MAP[(browser || '').toLowerCase()] || null) : null;
  const titleKeyword = target.replace(/\b(web|the|my|on|in|app|site|window|tab|page|browser)\b/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  const countTitle = await _closeByWindowTitle(titleKeyword, browserProc, forceFlag);
  if (countTitle > 0) return { success: true, closed: target, count: countTitle, method: 'title' };

  if (CLOSE_PROCESS_MAP[key]) {
    const count3 = await _closeByProcessName(CLOSE_PROCESS_MAP[key], true);
    if (count3 > 0) return { success: true, closed: target, count: count3, method: 'force-process' };
  }

  const derivedExe = key.replace(/\s+/g, '');
  if (derivedExe) {
    try { await execAsync(`cmd /c taskkill /F /IM "${derivedExe}.exe"`, { timeout: 5000 }); return { success: true, closed: target, count: 1, method: 'derived-exe' }; } catch (_) {}
  }

  return { success: false, error: `No running window found matching "${target}". It may already be closed.` };
}

// ─── Process Monitor ──────────────────────────────────────────────────────────

async function getProcessList() {
  const { stdout } = await execAsync('tasklist /FO CSV /NH', { timeout: 8000 });
  const processes = stdout.trim().split('\n').filter(Boolean).map(line => {
    const p = line.split('","').map(s => s.replace(/"/g, '').trim());
    return { name: p[0], pid: p[1], session: p[2], memKB: parseInt((p[4] || '0').replace(/[^\d]/g, ''), 10) };
  }).filter(p => p.name);
  processes.sort((a, b) => b.memKB - a.memKB);
  return processes.slice(0, 60);
}

async function killProcess(pid) {
  await execAsync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
}

// ─── Network Info ─────────────────────────────────────────────────────────────

async function getNetworkInfo() {
  const pingOut = await execAsync('ping -n 2 8.8.8.8', { timeout: 10000 }).then(r => r.stdout).catch(() => '');
  const ifaces  = Object.entries(os.networkInterfaces())
    .map(([name, addrs]) => ({ name, addresses: (addrs || []).filter(a => !a.internal).map(a => ({ address: a.address, family: a.family })) }))
    .filter(i => i.addresses.length);
  const pingMatch = pingOut.match(/Average\s*=\s*(\d+)ms/i) || pingOut.match(/time[<=](\d+)ms/i);
  return { interfaces: ifaces, online: /Reply from/i.test(pingOut), pingMs: pingMatch ? parseInt(pingMatch[1], 10) : null };
}

// ─── Git Integration ──────────────────────────────────────────────────────────

const GIT_SAFE_CMDS = new Set(['status','log','diff','branch','add','commit','push','pull','fetch','stash','checkout','reset','show','remote']);

async function runGitCommand(cwd, subcommand, args) {
  if (!subcommand || !GIT_SAFE_CMDS.has(subcommand.toLowerCase()))
    throw new Error('Disallowed git subcommand');
  const safeCwd  = cwd && fs.existsSync(String(cwd)) ? String(cwd) : process.cwd();
  const safeArgs = (Array.isArray(args) ? args : [String(args || '')]).map(a => String(a).replace(/[;&|`$<>]/g, '')).join(' ').trim();
  const { stdout, stderr } = await execAsync(`git ${subcommand} ${safeArgs}`.trim(), { cwd: safeCwd, timeout: 15000 });
  return (stdout + stderr).trim() || '(no output)';
}

// ─── Code Sandbox ─────────────────────────────────────────────────────────────

const SANDBOX_DANGER = /require\s*\(\s*['"](?:child_process|fs|net|http|https|os|cluster|worker_threads|vm)['"]|process\.exit|__dirname|__filename|eval\s*\(|Function\s*\(/i;

async function runCode(code, language) {
  if (!code || typeof code !== 'string') throw new Error('code required');
  const lang = (language || 'javascript').toLowerCase();
  if ((lang === 'javascript' || lang === 'js') && SANDBOX_DANGER.test(code))
    return { success: false, error: 'Blocked: dangerous module/function detected' };
  const tmpDir = os.tmpdir();
  let file;
  try {
    let cmd;
    if (lang === 'javascript' || lang === 'js' || lang === 'node') {
      file = path.join(tmpDir, `jv_sb_${Date.now()}.js`); cmd = `node "${file}"`;
    } else if (lang === 'python' || lang === 'py') {
      file = path.join(tmpDir, `jv_sb_${Date.now()}.py`); cmd = `python "${file}"`;
    } else return { success: false, error: 'Supported: javascript, python' };
    fs.writeFileSync(file, code, 'utf8');
    const { stdout, stderr } = await execAsync(cmd, { timeout: 10000, cwd: tmpDir });
    return { success: true, output: (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim() || '(no output)' };
  } catch (e) {
    return { success: false, error: e.message, output: e.stdout || '' };
  } finally {
    if (file) try { fs.unlinkSync(file); } catch {}
  }
}

// ─── Window Manager ───────────────────────────────────────────────────────────

async function getWindows() {
  const psCmd = `[System.Diagnostics.Process]::GetProcesses() | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -Property Id,ProcessName,MainWindowTitle | ConvertTo-Json`;
  const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { timeout: 8000 });
  let windows = [];
  try { windows = JSON.parse(stdout); if (!Array.isArray(windows)) windows = [windows]; } catch {}
  return windows.filter(Boolean).slice(0, 30);
}

async function windowAction(pid, action) {
  if (action === 'close') {
    await execAsync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
    return { success: true };
  }
  if (action === 'focus') {
    const psCmd = `$p=[System.Diagnostics.Process]::GetProcessById(${pid});Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.Interaction]::AppActivate($p.Id)`;
    await execAsync(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 5000 });
    return { success: true };
  }
  throw new Error('action must be close or focus');
}

module.exports = {
  executeShellCommand, openAnyAppTarget, openInBrowser,
  getScannedApps, fuzzyFindApp, getSystemInfo,
  getProcessList, killProcess, getNetworkInfo,
  runGitCommand, runCode, getWindows, windowAction, closeApp,
  normalizeAppKey
};
