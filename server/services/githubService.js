'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// JARVIS — GitHub Integration Service
// Uses GitHub REST API v3 with a personal access token (GITHUB_TOKEN in .env)
// Capabilities: repos, issues, notifications, PRs, search, create issue
// ═══════════════════════════════════════════════════════════════════════════════

const logger = require('../utils/logger');

const GITHUB_TOKEN   = process.env.GITHUB_TOKEN || '';
const GITHUB_API     = 'https://api.github.com';
const GITHUB_USER    = process.env.GITHUB_USERNAME || '';  // optional — auto-fetched if not set

let _cachedUser = null;

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function _gh(path, options = {}) {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set in .env');

  const resp = await fetch(`${GITHUB_API}${path}`, {
    method:  options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept':        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type':  'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GitHub API ${resp.status}: ${text.slice(0, 200)}`);
  }

  return resp.json();
}

// ─── User Info ─────────────────────────────────────────────────────────────

async function getAuthenticatedUser() {
  if (_cachedUser) return _cachedUser;
  _cachedUser = await _gh('/user');
  return _cachedUser;
}

// ─── Repositories ─────────────────────────────────────────────────────────────

async function getRepos(limit = 10) {
  const repos = await _gh(`/user/repos?sort=pushed&per_page=${limit}&affiliation=owner,collaborator`);
  return repos.map(r => ({
    name:        r.name,
    fullName:    r.full_name,
    description: r.description,
    private:     r.private,
    stars:       r.stargazers_count,
    language:    r.language,
    pushed:      r.pushed_at,
    url:         r.html_url,
    defaultBranch: r.default_branch
  }));
}

async function getRepo(owner, repo) {
  return _gh(`/repos/${owner}/${repo}`);
}

// ─── Issues ───────────────────────────────────────────────────────────────────

async function getIssues(repo, state = 'open', limit = 10) {
  // repo can be "owner/repo" or just "repo" (uses authenticated user as owner)
  const [owner, repoName] = repo.includes('/') ? repo.split('/') : [null, repo];
  const resolvedOwner = owner || (await getAuthenticatedUser()).login;

  const issues = await _gh(`/repos/${resolvedOwner}/${repoName}/issues?state=${state}&per_page=${limit}`);
  return issues
    .filter(i => !i.pull_request)  // exclude PRs from issues list
    .map(i => ({
      number:    i.number,
      title:     i.title,
      state:     i.state,
      author:    i.user?.login,
      labels:    i.labels?.map(l => l.name),
      created:   i.created_at,
      url:       i.html_url
    }));
}

async function createIssue(repo, title, body = '', labels = []) {
  const [owner, repoName] = repo.includes('/') ? repo.split('/') : [null, repo];
  const resolvedOwner = owner || (await getAuthenticatedUser()).login;

  const issue = await _gh(`/repos/${resolvedOwner}/${repoName}/issues`, {
    method: 'POST',
    body:   { title, body, labels }
  });
  return {
    number: issue.number,
    title:  issue.title,
    url:    issue.html_url
  };
}

// ─── Pull Requests ────────────────────────────────────────────────────────────

async function getPRs(repo, state = 'open', limit = 10) {
  const [owner, repoName] = repo.includes('/') ? repo.split('/') : [null, repo];
  const resolvedOwner = owner || (await getAuthenticatedUser()).login;

  const prs = await _gh(`/repos/${resolvedOwner}/${repoName}/pulls?state=${state}&per_page=${limit}`);
  return prs.map(p => ({
    number:  p.number,
    title:   p.title,
    state:   p.state,
    author:  p.user?.login,
    branch:  p.head?.ref,
    created: p.created_at,
    url:     p.html_url
  }));
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function getNotifications(unreadOnly = true) {
  const notifs = await _gh(`/notifications?all=${!unreadOnly}&per_page=15`);
  return notifs.map(n => ({
    id:       n.id,
    type:     n.subject?.type,
    title:    n.subject?.title,
    repo:     n.repository?.full_name,
    reason:   n.reason,
    unread:   n.unread,
    updated:  n.updated_at
  }));
}

async function markNotificationsRead() {
  await fetch(`${GITHUB_API}/notifications`, {
    method:  'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Length': '0'
    }
  });
  return { success: true };
}

// ─── Search ───────────────────────────────────────────────────────────────────

async function searchRepos(query, limit = 5) {
  const data = await _gh(`/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}&sort=stars`);
  return (data.items || []).map(r => ({
    fullName:    r.full_name,
    description: r.description,
    stars:       r.stargazers_count,
    language:    r.language,
    url:         r.html_url
  }));
}

async function searchCode(query, limit = 5) {
  const data = await _gh(`/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`);
  return (data.items || []).map(i => ({
    path:   i.path,
    repo:   i.repository?.full_name,
    url:    i.html_url
  }));
}

// ─── Intent Parser ────────────────────────────────────────────────────────────

const GITHUB_INTENTS = [
  // Repos
  { re: /^(?:show|list|get|my)\s+(?:github\s+)?repos?(?:\s+list)?$/i,  action: 'list_repos' },
  // Issues for a repo
  { re: /^(?:show|list|get)\s+(?:issues?\s+(?:for|in|on)\s+|open\s+issues?\s+(?:for|in|on)\s+)(.+)$/i, action: 'list_issues', group: 1 },
  // Create issue
  { re: /^create\s+(?:an?\s+)?(?:github\s+)?issue\s+(?:titled?|called|named?)\s+"?(.+?)"?\s+in\s+(.+)$/i, action: 'create_issue', group: [1, 2] },
  { re: /^create\s+(?:an?\s+)?(?:github\s+)?issue\s+(?:in|on)\s+(\S+)\s+(?:titled?|called|named?)\s+"?(.+)"?$/i, action: 'create_issue_rev', group: [2, 1] },
  // PRs
  { re: /^(?:show|list|get)\s+(?:pull\s+requests?|prs?)\s+(?:for|in|on)\s+(.+)$/i, action: 'list_prs', group: 1 },
  // Notifications
  { re: /^(?:check|show|get|my)\s+github\s+notifications?$/i, action: 'notifications' },
  { re: /^mark\s+(?:github\s+)?notifications?\s+(?:as\s+)?read$/i, action: 'mark_read' },
  // Search repos
  { re: /^(?:search|find)\s+github\s+repos?\s+(?:for|about)\s+(.+)$/i, action: 'search_repos', group: 1 },
  // Status / profile
  { re: /^(?:my\s+)?github\s+(?:profile|status|info|account)$/i, action: 'profile' },
];

function parseGitHubIntent(message) {
  const msg = String(message || '').trim();
  for (const intent of GITHUB_INTENTS) {
    const m = msg.match(intent.re);
    if (m) {
      if (Array.isArray(intent.group)) {
        return { action: intent.action, params: intent.group.map(g => (m[g] || '').trim()), raw: msg };
      }
      return {
        action: intent.action,
        query:  intent.group ? (m[intent.group] || '').trim() : undefined,
        raw:    msg
      };
    }
  }
  return null;
}

// ─── Handle Intent ────────────────────────────────────────────────────────────

async function handleIntent(intent) {
  if (!GITHUB_TOKEN) {
    return { success: false, reply: 'GitHub token not configured, Boss. Add GITHUB_TOKEN to your .env file.' };
  }

  try {
    switch (intent.action) {
      case 'list_repos': {
        const repos = await getRepos(8);
        if (!repos.length) return { success: true, reply: 'No repos found, Boss.' };
        const list = repos.map(r => `• **${r.name}** ${r.language ? `[${r.language}]` : ''} — ${r.description || 'No description'} (⭐${r.stars})`).join('\n');
        return { success: true, reply: `Your GitHub repos, Boss:\n${list}` };
      }

      case 'list_issues': {
        const issues = await getIssues(intent.query, 'open', 8);
        if (!issues.length) return { success: true, reply: `No open issues in ${intent.query}, Boss.` };
        const list = issues.map(i => `• #${i.number} — ${i.title}`).join('\n');
        return { success: true, reply: `Open issues in **${intent.query}**, Boss:\n${list}` };
      }

      case 'create_issue': {
        const [title, repo] = intent.params;
        const issue = await createIssue(repo, title);
        return { success: true, reply: `Issue #${issue.number} created in ${repo}, Boss: "${issue.title}"\n${issue.url}` };
      }

      case 'create_issue_rev': {
        const [title, repo] = intent.params;
        const issue = await createIssue(repo, title);
        return { success: true, reply: `Issue #${issue.number} created in ${repo}, Boss: "${issue.title}"\n${issue.url}` };
      }

      case 'list_prs': {
        const prs = await getPRs(intent.query, 'open', 8);
        if (!prs.length) return { success: true, reply: `No open PRs in ${intent.query}, Boss.` };
        const list = prs.map(p => `• #${p.number} — ${p.title} (${p.branch})`).join('\n');
        return { success: true, reply: `Open PRs in **${intent.query}**, Boss:\n${list}` };
      }

      case 'notifications': {
        const notifs = await getNotifications(true);
        if (!notifs.length) return { success: true, reply: "You're all caught up on GitHub, Boss. No unread notifications." };
        const list = notifs.slice(0, 8).map(n => `• [${n.type}] ${n.title} — ${n.repo}`).join('\n');
        return { success: true, reply: `${notifs.length} GitHub notification(s), Boss:\n${list}` };
      }

      case 'mark_read': {
        await markNotificationsRead();
        return { success: true, reply: 'All GitHub notifications marked as read, Boss.' };
      }

      case 'search_repos': {
        const repos = await searchRepos(intent.query, 5);
        if (!repos.length) return { success: true, reply: `No repos found for "${intent.query}", Boss.` };
        const list = repos.map(r => `• **${r.fullName}** — ${r.description || 'No description'} (⭐${r.stars})`).join('\n');
        return { success: true, reply: `GitHub repos matching "${intent.query}":\n${list}` };
      }

      case 'profile': {
        const user = await getAuthenticatedUser();
        return { success: true, reply: `GitHub profile, Boss:\n• Username: ${user.login}\n• Name: ${user.name || 'N/A'}\n• Public repos: ${user.public_repos}\n• Followers: ${user.followers}\n• Following: ${user.following}` };
      }

      default: return { success: false, reply: 'Unknown GitHub command, Boss.' };
    }
  } catch (err) {
    logger.error('GitHub intent error: ' + err.message);
    return { success: false, reply: `GitHub error: ${err.message}` };
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

function getStatus() {
  return {
    configured: !!GITHUB_TOKEN,
    username:   GITHUB_USER || null
  };
}

module.exports = {
  getAuthenticatedUser, getRepos, getRepo,
  getIssues, createIssue, getPRs,
  getNotifications, markNotificationsRead,
  searchRepos, searchCode,
  parseGitHubIntent, handleIntent,
  getStatus
};
