// ═══════════════════════════════════════════════
// JARVIS — System Command Handler
// open apps · run shell commands · system info · app discovery
// ═══════════════════════════════════════════════

let _installedApps = [];   // cached from /api/apps/scan
let _appsScanned   = false;

// Background scan on page load — silent
async function backgroundScanApps() {
  try {
    const r = await fetch('/api/apps/scan');
    const d = await r.json();
    if (d.success) {
      _installedApps = d.apps;
      _appsScanned   = true;
      console.log(`📱 JARVIS: ${d.count} apps indexed`);
    }
  } catch(_) {}
}

// ── Patterns ────────────────────────────────────────────────────────────────

function detectAppListIntent(text) {
  return /\b(list|show|what|tell me|display)\b.{0,25}\b(apps?|applications?|programs?|software|installed)\b/i.test(text)
      || /\b(apps?|applications?|programs?|software)\b.{0,20}\b(installed|available|i have|on my|in my)\b/i.test(text)
      || /\bwhat.{0,10}\b(apps?|applications?|programs?|software)\b.{0,20}\b(do i have|available|installed)\b/i.test(text);
}

function detectOpenAppIntent(text) {
  return /\b(open|launch|start|fire\s*up|load)\s+(?:the\s+|my\s+|up\s+)?([a-z0-9.+#\- ]+?)(?:\s+(?:app|application|program|software|for\s*me|please|now|up))?\s*$/i.test(text.trim())
      && !/\b(open\s+a\s+|open\s+an?\s+(?:new|browser|window|tab|file|folder|document))\b/i.test(text);
}

function _extractAppName(text) {
  const m = text.match(/\b(?:open|launch|start|fire\s*up|load)\s+(?:the\s+|my\s+|up\s+)?([a-z0-9.+#\- ]+?)(?:\s+(?:app|application|program|software|for\s*me|please|now|up))?\s*$/i);
  return m ? m[1].trim() : null;
}

function detectRunCommandIntent(text) {
  // Explicit run/exec keywords
  if (/\b(execute|exec)\s+/i.test(text)) return true;
  // Quoted command: run 'ipconfig' or run "dir"
  if (/\b(run|cmd|shell|powershell|terminal)\s+[`"'](.+)[`"']/i.test(text)) return true;
  // Well-known bare commands
  if (/\brun\s+(ipconfig|dir\b|ping|netstat|systeminfo|tasklist|whoami|hostname|echo\s+\S|cls|date|time|ver\b)/i.test(text)) return true;
  // Open terminal/cmd window
  if (/\bopen\s+(?:a\s+)?(?:cmd|command\s*prompt|terminal|powershell|shell)\b/i.test(text)) return true;
  return false;
}

function detectSysInfoIntent(text) {
  return /\b(system\s*info|hardware\s*info|my\s*system|computer\s*info|machine\s*info|pc\s*info|specs?)\b/i.test(text)
      || /\b(ram|memory|cpu|processor|disk|storage|uptime|os\s*version|operating\s*system|how\s*much\s*ram)\b.{0,25}\b(usage|info|check|available|use|free|left|status)\b/i.test(text)
      || /\b(check|show|what.{0,10}(is|are)).{0,20}\b(ram|memory|cpu|disk|storage|uptime)\b/i.test(text);
}

// ── Music Detection & Handler ─────────────────────────────────────────────────
function detectMusicIntent(text) {
  const t = text.toLowerCase();
  // Explicit music/song/track commands
  if (/\b(play|listen to|put on|queue|blast|stream)\b.{0,40}\b(music|song|track|album|playlist|audio|mp3)\b/i.test(t)) return true;
  // "play [something]" — catch all play commands including "play X on youtube/spotify"
  // Only exclude non-music streaming platforms
  if (/\bplay\s+(?!on\s+(?:netflix|prime\s*video|disney\+?))/i.test(t)) return true;
  // List / show music
  if (/\b(list|show|what|tell me)\b.{0,20}\b(music|songs?|tracks?|my music|music library)\b/i.test(t)) return true;
  // Media controls — multi-word first, then exact single-word
  if (/\b(pause|resume|stop music|skip|next song|next track|previous song|previous track|mute|volume up|volume down)\b/i.test(t)) return true;
  // Exact single-word commands (anchored so "what's next" or "stop that" don't trigger)
  if (/^(next|previous|back|stop|pause|play|resume|skip|mute)$/.test(t.trim())) return true;
  // Open music player app
  if (/\bopen\s+(music|media player|vlc|groove|winamp|foobar)\b/i.test(t)) return true;
  return false;
}


// ── Shared media control dispatcher ──────────────────────────────────────────
// Routes to: (1) embedded YouTube player, (2) Spotify window, (3) system media keys
async function _dispatchMusicControl(ytCmd, sysKey, label, boss) {
  const labels = {
    pause:'Paused', play:'Resumed', toggle:'Toggled',
    next:'Next track', previous:'Previous track',
    mute:'Muted/Unmuted', 'vol-up':'Volume up', 'vol-down':'Volume down'
  };
  const reply = `${labels[ytCmd] || label}${boss}.`;

  // 1. YouTube embedded player is active
  if (typeof isYTPlayerActive === 'function' && isYTPlayerActive()) {
    if (typeof musicPlayerCmd === 'function') musicPlayerCmd(ytCmd);
    addMessage('ai', reply);
    return true;
  }

  // 2. Spotify is open — use Spotify keyboard shortcuts
  if (window._spotifyOpen) {
    try {
      await fetch('/api/spotify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'control', key: sysKey }) });
      addMessage('ai', reply);
    } catch(e) { addMessage('ai', `Control failed: ${e.message}`); }
    return true;
  }

  // 3. Fallback — system-wide media keys (works for any media player in focus)
  try {
    await fetch('/api/music', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'control', key: sysKey }) });
    addMessage('ai', reply);
  } catch(e) { addMessage('ai', `Control failed: ${e.message}`); }
  return true;
}

async function handleMusicCommand(text) {
  const t = text.toLowerCase().trim();
  const boss = isVerifiedBoss ? ', Boss' : '';

  // ── Media controls — multi-word phrases checked first (order matters) ──
  const controlMap = [
    ['stop music',       'pause',    'stop'],
    ['pause music',      'pause',    'pause'],
    ['resume music',     'play',     'play'],
    ['play music',       'play',     'play'],   // only triggers if no song name follows
    ['next song',        'next',     'next'],
    ['next track',       'next',     'next'],
    ['previous song',    'previous', 'previous'],
    ['previous track',   'previous', 'previous'],
    ['go back',          'previous', 'previous'],
    ['play pause',       'toggle',   'pause'],
    ['volume up',        'vol-up',   'volume up'],
    ['volume down',      'vol-down', 'volume down'],
    // Single-word (checked via exact-trim below, not includes)
  ];
  // Check multi-word phrases
  for (const [phrase, ytCmd, sysKey] of controlMap) {
    if (t.includes(phrase)) {
      addMessage('user', text);
      return await _dispatchMusicControl(ytCmd, sysKey, phrase, boss);
    }
  }
  // Check exact single-word commands
  const _exactWord = t.trim();
  const _exactMap = { next:'next', previous:'previous', back:'previous', stop:'pause', pause:'pause', resume:'play', skip:'next', mute:'mute' };
  if (_exactMap[_exactWord]) {
    addMessage('user', text);
    return await _dispatchMusicControl(_exactMap[_exactWord] === 'mute' ? 'mute' : _exactMap[_exactWord],
      _exactMap[_exactWord] === 'mute' ? 'mute' : _exactMap[_exactWord], _exactWord, boss);
  }

  // ── List music library ──
  if (/\b(list|show|what|tell me)\b.{0,20}\b(music|songs?|tracks?|my music)\b/i.test(t)) {

    addMessage('user', text);
    setStatus('🎵 SCANNING MUSIC LIBRARY…');
    try {
      const r = await fetch('/api/music', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'scan' }) });
      const d = await r.json();
      setStatus('✓ SYSTEM ONLINE');
      if (!d.count) {
        addMessage('ai', `No local music files found${boss}. Say **"play [song name]"** and I'll search YouTube for you.`);
        return true;
      }
      const shown = d.tracks.slice(0, 60);
      const names = shown.map(tr => `- ${tr.name}`).join('\n');
      const more  = d.count > 60 ? `\n\n*(+${d.count-60} more. Say "play [song name]" to play.)*` : '';
      addMessage('ai', `🎵 **${d.count} tracks found${boss}**\n\n${names}${more}\n\nSay **"play [song name]"** to play.`);
    } catch(e) { setStatus('✓ SYSTEM ONLINE'); addMessage('ai', `Music scan failed: ${e.message}`); }
    return true;
  }

  // ── Open music player app ──
  if (/\bopen\s+(music|media player|vlc|groove|winamp|foobar|music\s+player)\b/i.test(t)) {
    const pm = t.match(/\bopen\s+(vlc|groove|winamp|foobar|media\s*player|music)\b/i);
    return await handleOpenApp(`open ${pm ? pm[1].trim() : 'groove'}`);
  }

  // ── Extract platform (spotify / soundcloud / youtube / etc.) ──
  // Matches: "on spotify", "in spotify", "via spotify", "through spotify", "at spotify", "from spotify"
  const _PLATFORM_LIST = 'spotify|soundcloud|apple\\s*music|amazon\\s*music|gaana|jiosaavn|youtube\\s*music|youtube';
  const _PLATFORM_RE   = new RegExp(`\\b(?:on|in|via|through|at|from)\\s+(${_PLATFORM_LIST})\\b`, 'i');
  const platformMatch  = t.match(_PLATFORM_RE);
  const platform       = platformMatch ? platformMatch[1].toLowerCase().replace(/\s+/g,'') : null;

  // Clean query: strip platform phrase + verb + filler words
  const cleanQ = t
    .replace(new RegExp(`\\b(?:on|in|via|through|at|from)\\s+(${_PLATFORM_LIST})`, 'gi'), '')
    .replace(/^(?:play|listen to|put on|blast|queue|stream)\s+/i, '')
    .replace(/\b(song|track|music|the|some|my|a)\b/gi, '')
    .replace(/\s{2,}/g, ' ').trim();
  const songQuery = cleanQ.length >= 2 ? cleanQ : null;

  // ── Platform-only (no specific song): open the platform directly ──
  // e.g. "play music in Spotify", "play something on Spotify"
  if (platform && (!songQuery || /^(music|something|anything|random|playlist|audio|songs?)$/.test(songQuery))) {
    addMessage('user', text);
    if (platform === 'spotify') {
      setStatus('🎵 OPENING SPOTIFY…');
      await fetch('/api/spotify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'search-play', query: '' }) });
      setStatus('✓ SYSTEM ONLINE');
      addMessage('ai', `🎵 Opening Spotify${boss}. Controls: say **pause**, **next**, **previous**, **stop**.`);
    } else {
      const platformUrls = {
        soundcloud:   'https://soundcloud.com',
        applemusic:   'https://music.apple.com',
        amazonmusic:  'https://music.amazon.com',
        gaana:        'https://gaana.com',
        jiosaavn:     'https://www.jiosaavn.com',
        youtubemusic: 'https://music.youtube.com',
        youtube:      'https://music.youtube.com',
      };
      const url = platformUrls[platform] || 'https://music.youtube.com';
      await fetch('/api/browse', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
      const pName = platform.replace('music','').trim();
      addMessage('ai', `🎵 Opening ${pName.charAt(0).toUpperCase()+pName.slice(1)}${boss}.`);
    }
    return true;
  }

  // Generic "play music" with no platform and no specific song ──
  if (!songQuery || /^(music|something|anything|random|playlist|audio|songs?)$/.test(songQuery)) {
    addMessage('user', text);
    setStatus('🎵 LOADING MUSIC…');
    try {
      const r = await fetch('/api/music', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'scan' }) });
      const d = await r.json();
      setStatus('✓ SYSTEM ONLINE');
      if (d.count > 0) {
        const track = d.tracks[Math.floor(Math.random() * Math.min(d.count, 20))];
        const pr = await fetch('/api/music', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'play', filePath: track.path }) });
        const pd = await pr.json();
        addMessage('ai', pd.success ? `🎵 Playing **${pd.playing}**${boss}.` : `Found ${d.count} tracks${boss}. Say "play [song name]" to play.`);
      } else {
        setStatus('🎵 SEARCHING YOUTUBE…');
        const sr = await fetch('/api/youtube-search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query: 'top hits 2024 music' }) });
        const sd = await sr.json();
        setStatus('✓ SYSTEM ONLINE');
        if (sd.success && sd.videoIds.length > 0) {
          playYouTube(sd.videoIds, sd.titles, 'Top Hits');
          addMessage('ai', `🎵 Playing top hits on YouTube${boss}.`);
        } else {
          await fetch('/api/browse', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url:'https://music.youtube.com' }) });
          addMessage('ai', `Opening YouTube Music${boss}.`);
        }
      }
    } catch(e) { setStatus('✓ SYSTEM ONLINE'); addMessage('ai', `Music failed: ${e.message}`); }
    return true;
  }

  // ── Specific song / artist requested ──
  addMessage('user', text);

  // Spotify — search + auto-play via desktop app or web
  if (platform === 'spotify') {
    setStatus(`🎵 SEARCHING SPOTIFY FOR "${songQuery.toUpperCase()}"…`);
    await fetch('/api/spotify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'search-play', query: songQuery }) });
    setStatus('✓ SYSTEM ONLINE');
    window._spotifyOpen = true;
    addMessage('ai', `🎵 Searching Spotify for **"${songQuery}"** and auto-playing${boss}. Say **pause**, **next**, or **previous** to control.`);
    return true;
  }

  // SoundCloud — open SoundCloud search
  if (platform === 'soundcloud') {
    await fetch('/api/browse', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: `https://soundcloud.com/search?q=${encodeURIComponent(songQuery)}` }) });
    addMessage('ai', `🎵 Searching SoundCloud for **"${songQuery}"**${boss}.`);
    return true;
  }

  // YouTube explicitly requested — embed player
  if (platform === 'youtube' || platform === 'youtubemusic') {
    setStatus(`🎵 SEARCHING YOUTUBE…`);
    try {
      const sr = await fetch('/api/youtube-search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query: songQuery }) });
      const sd = await sr.json();
      setStatus('✓ SYSTEM ONLINE');
      if (sd.success && sd.videoIds.length > 0) {
        playYouTube(sd.videoIds, sd.titles, songQuery);
        addMessage('ai', `🎵 Playing **"${sd.titles[0] || songQuery}"** on YouTube${boss}.`);
      } else {
        await fetch('/api/browse', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: `https://www.youtube.com/results?search_query=${encodeURIComponent(songQuery)}` }) });
        addMessage('ai', `Opened YouTube search for **"${songQuery}"**${boss}.`);
      }
    } catch(e) { setStatus('✓ SYSTEM ONLINE'); addMessage('ai', `YouTube search failed: ${e.message}`); }
    return true;
  }

  // Try local library first
  setStatus(`🎵 SEARCHING FOR "${songQuery.toUpperCase()}"…`);
  try {
    const r = await fetch('/api/music', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'search', query: songQuery }) });
    const d = await r.json();
    if (d.success && d.match) {
      await fetch('/api/music', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'play', filePath: d.match.fullPath }) });
      setStatus('✓ SYSTEM ONLINE');
      addMessage('ai', `🎵 Playing **${d.match.name}** from local library${boss}.`);
      return true;
    }

    // Not local — search YouTube and embed player directly ──
    setStatus(`🎵 SEARCHING YOUTUBE…`);
    const sr = await fetch('/api/youtube-search', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ query: songQuery }) });
    const sd = await sr.json();
    setStatus('✓ SYSTEM ONLINE');
    if (sd.success && sd.videoIds.length > 0) {
      playYouTube(sd.videoIds, sd.titles, songQuery);
      const title = sd.titles[0] || songQuery;
      addMessage('ai', `🎵 Playing **"${title}"** on YouTube${boss}.`);
    } else {
      // Last resort: open YouTube search page in browser
      await fetch('/api/browse', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: `https://www.youtube.com/results?search_query=${encodeURIComponent(songQuery)}` }) });
      addMessage('ai', `Couldn't auto-play — opened YouTube search for **"${songQuery}"**${boss}.`);
    }
  } catch(e) { setStatus('✓ SYSTEM ONLINE'); addMessage('ai', `Music search failed: ${e.message}`); }
  return true;
}

// ── Site Map — known website names → URLs ─────────────────────────────────────
const SITE_MAP = {
  // Search engines
  'google':          'https://www.google.com',
  'bing':            'https://www.bing.com',
  'duckduckgo':      'https://duckduckgo.com',
  // Video
  'youtube':         'https://www.youtube.com',
  'netflix':         'https://www.netflix.com',
  'primevideo':      'https://www.primevideo.com',
  'prime video':     'https://www.primevideo.com',
  'hotstar':         'https://www.hotstar.com',
  'disney hotstar':  'https://www.hotstar.com',
  // Social
  'facebook':        'https://www.facebook.com',
  'instagram':       'https://www.instagram.com',
  'twitter':         'https://twitter.com',
  'x':               'https://x.com',
  'linkedin':        'https://www.linkedin.com',
  'reddit':          'https://www.reddit.com',
  'threads':         'https://www.threads.net',
  // Messaging
  'whatsapp':        'https://web.whatsapp.com',
  'whatsapp web':    'https://web.whatsapp.com',
  'telegram web':    'https://web.telegram.org',
  // Google services
  'gmail':           'https://mail.google.com',
  'google drive':    'https://drive.google.com',
  'drive':           'https://drive.google.com',
  'google maps':     'https://maps.google.com',
  'maps':            'https://maps.google.com',
  'google meet':     'https://meet.google.com',
  'meet':            'https://meet.google.com',
  'google translate':'https://translate.google.com',
  'translate':       'https://translate.google.com',
  'google news':     'https://news.google.com',
  'google docs':     'https://docs.google.com',
  'google sheets':   'https://sheets.google.com',
  'google calendar': 'https://calendar.google.com',
  // Dev tools
  'github':          'https://github.com',
  'stackoverflow':   'https://stackoverflow.com',
  'stack overflow':  'https://stackoverflow.com',
  'chatgpt':         'https://chatgpt.com',
  'chat gpt':        'https://chatgpt.com',
  'claude':          'https://claude.ai',
  'copilot':         'https://copilot.microsoft.com',
  'github copilot':  'https://copilot.microsoft.com',
  'perplexity':      'https://www.perplexity.ai',
  'codepen':         'https://codepen.io',
  'npm':             'https://www.npmjs.com',
  'npmjs':           'https://www.npmjs.com',
  'maven':           'https://mvnrepository.com',
  'mvnrepository':   'https://mvnrepository.com',
  'vercel':          'https://vercel.com',
  'netlify':         'https://netlify.com',
  'heroku':          'https://heroku.com',
  'aws':             'https://console.aws.amazon.com',
  'azure':           'https://portal.azure.com',
  'dev.to':          'https://dev.to',
  'medium':          'https://medium.com',
  // Shopping
  'amazon':          'https://www.amazon.in',
  'flipkart':        'https://www.flipkart.com',
  // Productivity
  'notion':          'https://www.notion.so',
  'trello':          'https://trello.com',
  'jira':            'https://www.atlassian.com/software/jira',
  'figma':           'https://www.figma.com',
  'canva':           'https://www.canva.com',
  'zoom':            'https://zoom.us',
  'teams web':       'https://teams.microsoft.com',
  'outlook web':     'https://outlook.live.com',
  'outlook':         'https://outlook.live.com',
  // Info
  'wikipedia':       'https://www.wikipedia.org',
  'weather':         'https://weather.com',
  'news':            'https://news.google.com',
  'spotify web':     'https://open.spotify.com',
};

// ── Browse / URL Detection ────────────────────────────────────────────────────
function detectBrowseIntent(text) {
  const t = text.toLowerCase().trim();
  // Has URL pattern
  if (/https?:\/\/|www\.[a-z]/.test(t)) return true;
  // Has .com / .in / .org / .io at end
  if (/\b\w+\.(com|in|org|io|net|co)\b/i.test(t)) return true;
  // Open/visit a known site name
  if (/\b(open|go to|visit|browse|load|take me to|navigate to|show me)\b/i.test(t)) {
    if (Object.keys(SITE_MAP).some(k => t.includes(k))) return true;
  }
  // Search intent
  if (/\b(search|look up|google|find|search for)\b.{1,60}\b(on|in|via|using)?\b.{0,15}\b(google|youtube|bing|web|internet|chrome|browser)\b/i.test(t)) return true;
  if (/\bsearch\s+(for\s+|the\s+)?/i.test(t) && !/\bsearch\s+(my|this|the)\b/i.test(t)) return true;
  if (/\b(play|watch)\b.{1,50}\b(on|in)\b.{0,15}\b(youtube|spotify|netflix)\b/i.test(t)) return true;
  if (/\bgoogle\s+.{3,}/i.test(t) && !/\bgoogle\s+(chrome|maps|drive|docs|meet|news|sheets|calendar|translate)\b/i.test(t)) return true;
  return false;
}

// ── Resolve URL from text ─────────────────────────────────────────────────────
function resolveBrowseUrl(text) {
  const t = text.toLowerCase().trim();

  // 1. Direct URL (already has http/https)
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return { url: urlMatch[0], label: urlMatch[0] };

  // 2. www.domain.com
  const wwwMatch = text.match(/www\.[a-z0-9.-]+\.[a-z]{2,}/i);
  if (wwwMatch) return { url: 'https://' + wwwMatch[0], label: wwwMatch[0] };

  // 3. bare domain like "github.com"
  const domainMatch = text.match(/\b([a-z0-9-]+\.(com|in|org|io|net|co))\b/i);
  if (domainMatch) return { url: 'https://' + domainMatch[0], label: domainMatch[0] };

  // 4. YouTube play/watch/search
  const ytMatch = t.match(/\b(?:play|watch|search(?:\s+for)?)\s+(.+?)\s+(?:on\s+)?(?:in\s+)?youtube\b/i)
                || t.match(/\byoutube\s+(?:search(?:\s+for)?\s+)?(.+)/i);
  if (ytMatch) {
    const q = encodeURIComponent(ytMatch[1].trim());
    return { url: `https://www.youtube.com/results?search_query=${q}`, label: `YouTube: "${ytMatch[1].trim()}"` };
  }

  // 5. Google search — "search for X", "google X", "look up X"
  const gMatch = t.match(/\b(?:search(?:\s+for)?|look\s+up|find|google)\s+(.+?)(?:\s+on\s+(?:google|web|internet|chrome|browser))?\s*$/i);
  if (gMatch) {
    const q = encodeURIComponent(gMatch[1].trim());
    return { url: `https://www.google.com/search?q=${q}`, label: `Google: "${gMatch[1].trim()}"` };
  }

  // 6. "search X on youtube/google"
  const engineMatch = t.match(/\b(?:search\s+(?:for\s+)?)?(.+?)\s+on\s+(google|youtube|bing)\b/i);
  if (engineMatch) {
    const q = encodeURIComponent(engineMatch[1].trim());
    const engine = engineMatch[2].toLowerCase();
    const base = engine === 'youtube' ? `https://www.youtube.com/results?search_query=${q}`
               : engine === 'bing'    ? `https://www.bing.com/search?q=${q}`
               :                        `https://www.google.com/search?q=${q}`;
    return { url: base, label: `${engine}: "${engineMatch[1].trim()}"` };
  }

  // 7. Open/visit/go to [site name]
  const siteMatch = t.match(/\b(?:open|go\s+to|visit|browse|load|take\s+me\s+to|navigate\s+to|show(?:\s+me)?)\s+(?:the\s+)?(.+?)(?:\s+(?:website|site|page|web))?\s*$/i);
  if (siteMatch) {
    const name = siteMatch[1].trim();
    const mapped = SITE_MAP[name];
    if (mapped) return { url: mapped, label: name.charAt(0).toUpperCase() + name.slice(1) };
  }

  // 8. Just a known site name anywhere
  for (const [key, url] of Object.entries(SITE_MAP)) {
    if (t.includes(key)) return { url, label: key.charAt(0).toUpperCase() + key.slice(1) };
  }

  return null;
}

// ── Handle browse command ─────────────────────────────────────────────────────
async function handleBrowse(text) {
  const resolved = resolveBrowseUrl(text);
  if (!resolved) return false;

  addMessage('user', text);
  const preferChrome = /\bchrome\b/i.test(text);
  setStatus(`🌐 OPENING ${resolved.label.toUpperCase()}…`);

  try {
    const r = await fetch('/api/browse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: resolved.url, preferChrome })
    });
    const d = await r.json();
    setStatus('✓ SYSTEM ONLINE');

    if (d.success) {
      const boss   = isVerifiedBoss ? ', Boss' : '';
      const via    = d.openedWith ? ` via ${d.openedWith}` : '';
      addMessage('ai', `🌐 Opened **${resolved.label}**${via}${boss}.\n\`${resolved.url}\``);
    } else {
      addMessage('ai', `Couldn't open ${resolved.label}: ${d.error}`);
    }
  } catch(e) {
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `Browse failed: ${e.message}`);
  }
  return true;
}

// ── List Installed Apps ───────────────────────────────────────────────────────
async function handleAppList(text, filterQuery = '') {
  addMessage('user', text);
  setStatus('📱 SCANNING INSTALLED APPS…');

  try {
    const r = await fetch('/api/apps/scan?' + (filterQuery ? '' : ''));
    const d = await r.json();
    setStatus('✓ SYSTEM ONLINE');

    if (!d.success || !d.apps.length) {
      addMessage('ai', 'No apps found in Start Menu.');
      return true;
    }

    _installedApps = d.apps;
    _appsScanned   = true;

    // Group by first letter
    let list = d.apps;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      list = d.apps.filter(a => a.name.toLowerCase().includes(q));
    }

    const boss  = isVerifiedBoss ? ', Boss' : '';
    const total = list.length;

    // Show max 80 apps to avoid wall of text, grouped alphabetically
    const show = list.slice(0, 80);
    const groups = {};
    for (const a of show) {
      const letter = a.name[0].toUpperCase();
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(a.name);
    }

    const lines = Object.keys(groups).sort().map(l =>
      `**${l}** — ${groups[l].join(', ')}`
    );

    const truncNote = total > 80 ? `\n\n*(Showing 80 of ${total}. Say "show apps starting with X" to filter.)*` : '';
    addMessage('ai', `📱 **${total} apps installed${boss}**\n\n${lines.join('\n')}${truncNote}\n\nSay **"open [app name]"** to launch any of these.`);
  } catch(e) {
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `App scan failed: ${e.message}`);
  }
  return true;
}

// ── Open Application ─────────────────────────────────────────────────────────
async function handleOpenApp(text) {
  const appName = _extractAppName(text);
  if (!appName) return false;

  addMessage('user', text);
  setStatus(`🚀 OPENING ${appName.toUpperCase()}…`);

  try {
    const r = await fetch('/api/open-app', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName })
    });
    const d = await r.json();
    setStatus('✓ SYSTEM ONLINE');

    if (d.success) {
      const reply = isVerifiedBoss
        ? `${d.opened} is open, Boss.`
        : `Opened ${d.opened}.`;
      addMessage('ai', reply);
    } else {
      const avail = d.available ? `\n\nApps I can open: ${d.available.slice(0,20).join(', ')}` : '';
      addMessage('ai', `Couldn't open "${appName}". ${d.error}${avail}`);
    }
  } catch(e) {
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `Failed to open app: ${e.message}`);
  }
  return true;
}

// ── Run Shell Command ─────────────────────────────────────────────────────────
async function handleRunCommand(text) {
  // Handle "open cmd/terminal/powershell" → delegate to open-app
  if (/\bopen\s+(?:a\s+)?(?:cmd|command\s*prompt|terminal|powershell|shell)\b/i.test(text)) {
    return handleOpenApp(text.replace(/\bopen\b/i, 'open').replace(/command\s*prompt/i, 'cmd'));
  }

  // Extract the actual command from text
  const m = text.match(/\b(?:run|execute|exec)\s+(?:the\s+|this\s+)?(?:command\s+)?[`"']?(.+?)[`"']?\s*$/i)
         || text.match(/\brun\s+(ipconfig|dir\b|ping(?:\s+\S+)?|netstat|systeminfo|tasklist|whoami|hostname|echo\s+\S+)/i);
  if (!m) return false;
  const command = m[1].trim();

  addMessage('user', text);

  // Show what will run
  const msgs = document.getElementById('messages');
  const runDiv = document.createElement('div');
  runDiv.className = 'msg ai'; runDiv.id = 'cmd_running';
  runDiv.innerHTML = `
    <div class="avatar ai">⬡</div>
    <div class="bubble ai">
      <div class="cmd-running">
        <span class="cmd-running-icon">⚙</span>
        <span>Running: <code>${command.replace(/</g,'&lt;')}</code></span>
      </div>
    </div>`;
  msgs.appendChild(runDiv);
  scrollToBottom();
  setStatus('⚙ EXECUTING COMMAND…');

  try {
    const r = await fetch('/api/run-command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, shell: 'powershell' })
    });
    const d = await r.json();
    document.getElementById('cmd_running')?.remove();
    setStatus('✓ SYSTEM ONLINE');

    if (d.success) {
      const output = d.stdout || '(no output)';
      const boss   = isVerifiedBoss ? ', Boss' : '';
      const reply  = `**Command:** \`${d.command}\`\n\n\`\`\`\n${output}\n\`\`\`${boss ? `\n\nDone${boss}.` : ''}`;
      addMessage('ai', reply);
    } else {
      const errOut = d.stdout ? `\n\n\`\`\`\n${d.stdout}\n\`\`\`` : '';
      addMessage('ai', `Command failed: ${d.error}${errOut}`);
    }
  } catch(e) {
    document.getElementById('cmd_running')?.remove();
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `Execution error: ${e.message}`);
  }
  return true;
}

// ── System Info ───────────────────────────────────────────────────────────────
async function handleSysInfo(text) {
  if (!detectSysInfoIntent(text)) return false;

  addMessage('user', text);
  setStatus('💻 READING SYSTEM INFO…');

  try {
    const r = await fetch('/api/system-info');
    const d = await r.json();
    setStatus('✓ SYSTEM ONLINE');

    const boss  = isVerifiedBoss ? ', Boss' : '';
    const memBar = '█'.repeat(Math.round(d.memPct / 10)) + '░'.repeat(10 - Math.round(d.memPct / 10));
    const reply =
      `💻 **System Status${boss}**\n\n` +
      `**Host:** ${d.hostname}\n` +
      `**OS:** ${d.osRelease} (${d.arch})\n` +
      `**CPU:** ${d.cpu} — ${d.cpuCores} cores\n` +
      `**Memory:** ${d.usedMemory} / ${d.totalMemory} (${d.memPct}%)\n` +
      `\`[${memBar}] ${d.memPct}%\`\n` +
      `**Free RAM:** ${d.freeMemory}\n` +
      `**Uptime:** ${d.uptime}\n` +
      `**Node:** ${d.nodeVersion}\n` +
      `**Home:** \`${d.homeDir}\`\n` +
      `**Time:** ${d.now}`;
    addMessage('ai', reply);
  } catch(e) {
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `System info failed: ${e.message}`);
  }
  return true;
}

// ── Close Application / Window ───────────────────────────────────────────────
function detectCloseIntent(text) {
  const t = text.trim();
  // Must start with a close verb followed by something real
  return /^(close|quit|exit|kill|terminate|force\s+close|shut\s*down)\s+.{2,}/i.test(t);
}

function _extractCloseTarget(text) {
  const t = text.trim();

  // Detect force flag
  const force = /\b(force\s+close|kill|terminate)\b/i.test(t);

  // Detect trailing "on/in <browser>" qualifier: "... on chrome" / "... in edge"
  const browserRe = /\s+(?:on|in)\s+(chrome|firefox|edge|browser)\s*$/i;
  const browserMatch = t.match(browserRe);
  const browser = browserMatch ? browserMatch[1].toLowerCase() : null;
  const withoutBrowser = browserMatch ? t.slice(0, browserMatch.index).trim() : t;

  // Strip the close verb prefix
  const stripped = withoutBrowser
    .replace(/^(?:force\s+close|close|quit|exit|kill|terminate|shut\s*down)\s+/i, '')
    .replace(/^(?:the|my|all)\s+/i, '')
    .trim();

  if (!stripped) return null;

  // Strip trailing noise like "app", "application", "tab", "window", "site"
  const target = stripped.replace(/\s+(?:app|application|browser|tab|window|site|page)\s*$/i, '').trim();
  if (!target) return null;

  return { target, browser, force };
}

async function handleCloseApp(text) {
  const parsed = _extractCloseTarget(text);
  if (!parsed) return false;

  const { target, browser, force } = parsed;
  addMessage('user', text);

  const statusLabel = browser
    ? `${target.toUpperCase()} IN ${browser.toUpperCase()}`
    : target.toUpperCase();
  setStatus(`❌ CLOSING ${statusLabel}…`);

  try {
    const r = await fetch('/api/close-app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, browser, force })
    });
    const d = await r.json();
    setStatus('✓ SYSTEM ONLINE');

    const boss = isVerifiedBoss ? ', Boss' : '';
    if (d.success) {
      const count = d.count > 1 ? ` (${d.count} windows)` : '';
      addMessage('ai', `✅ **${target}** closed${count}${boss}.`);
    } else {
      addMessage('ai', `Couldn't close **${target}**${boss}. ${d.error || ''}`);
    }
  } catch (e) {
    setStatus('✓ SYSTEM ONLINE');
    addMessage('ai', `Close failed: ${e.message}`);
  }
  return true;
}

// ── Master dispatcher (called from sendMessage) ───────────────────────────────
// ── Location / GPS Intent Detection ──────────────────────────────────────────
function detectLocationIntent(text) {
  const t = text.toLowerCase();
  return /\b(where\s+am\s+i|my\s+(current\s+)?location|current\s+location|gps(\s+location)?|what\s+(city|country|state|place|area)\s+(am\s+i\s+in|is\s+this)|find\s+(my\s+)?location|detect\s+(my\s+)?location|locate\s+me|show\s+(my\s+)?location|what.s\s+my\s+location)\b/i.test(t)
      || /\b(my\s+coordinates?|my\s+(current\s+)?address|get\s+(my\s+)?location|where\s+(i\s+am|are\s+we))\b/i.test(t);
}

// ── GPS Location Handler ──────────────────────────────────────────────────────
async function handleLocationCommand(text) {
  if (!navigator.geolocation) {
    addMessage('user', text);
    addMessage('ai', `GPS is not supported in this browser${isVerifiedBoss ? ', Boss' : ''}.`);
    return true;
  }

  addMessage('user', text);
  setStatus('📍 FETCHING LOCATION...');

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const boss = isVerifiedBoss ? ', Boss' : '';
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': 'en', 'User-Agent': 'JARVIS-App/1.0' } }
          );
          const geo  = await resp.json();
          const addr = geo.address || {};
          const city    = addr.city || addr.town || addr.village || addr.county || '—';
          const state   = addr.state || '—';
          const country = addr.country || '—';
          const display = geo.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
          addMessage('ai',
            `📍 **Your Current Location${boss}**\n\n` +
            `**City:** ${city}\n` +
            `**State/Region:** ${state}\n` +
            `**Country:** ${country}\n` +
            `**Coordinates:** ${latitude.toFixed(6)}, ${longitude.toFixed(6)}\n` +
            `**Accuracy:** ±${Math.round(accuracy)} m\n` +
            `**Full Address:** ${display}`
          );
        } catch (e) {
          // Reverse geocode failed — show raw coords
          addMessage('ai',
            `📍 **Your GPS Coordinates${boss}**\n\n` +
            `**Latitude:** ${latitude.toFixed(6)}\n` +
            `**Longitude:** ${longitude.toFixed(6)}\n` +
            `**Accuracy:** ±${Math.round(accuracy)} m\n\n` +
            `_(Address lookup failed — ${e.message})_`
          );
        }
        setStatus('✓ SYSTEM ONLINE');
        resolve(true);
      },
      (err) => {
        setStatus('✓ SYSTEM ONLINE');
        const msgs = { 1: 'Location permission denied — please allow it in your browser.', 2: 'Position unavailable.', 3: 'Request timed out.' };
        addMessage('ai', `📍 Couldn't get your location${isVerifiedBoss ? ', Boss' : ''}: ${msgs[err.code] || err.message}`);
        resolve(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

async function handleSystemCommand(text) {
  if (typeof handleToolsCommand === 'function') {
    const toolsHandled = await handleToolsCommand(text);
    if (toolsHandled) return true;
  }
  if (detectSysInfoIntent(text))    return await handleSysInfo(text);
  if (detectAppListIntent(text))    return await handleAppList(text);
  if (detectLocationIntent(text))   return await handleLocationCommand(text);
  if (detectCloseIntent(text))      return await handleCloseApp(text);
  if (detectMusicIntent(text))      return await handleMusicCommand(text);  // ← before browse so "play X on youtube" is caught here
  if (detectBrowseIntent(text))     return await handleBrowse(text);
  if (detectOpenAppIntent(text))    return await handleOpenApp(text);
  if (detectRunCommandIntent(text)) return await handleRunCommand(text);
  return false;
}

// Kick off background scan when page loads
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => setTimeout(backgroundScanApps, 2000));
}
