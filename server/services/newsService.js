'use strict';

const logger = require('../utils/logger');

// ─── RSS Feed Map ─────────────────────────────────────────────────────────────

const RSS_FEEDS = {
  tech:          'https://feeds.bbci.co.uk/news/technology/rss.xml',
  world:         'https://feeds.bbci.co.uk/news/world/rss.xml',
  science:       'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  business:      'https://feeds.bbci.co.uk/news/business/rss.xml',
  hn:            'https://hnrss.org/frontpage',
  india:         'https://feeds.feedburner.com/ndtvnews-top-stories',
  sports:        'https://feeds.bbci.co.uk/sport/rss.xml',
  health:        'https://feeds.bbci.co.uk/news/health/rss.xml',
  entertainment: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'
};

// ─── In-Memory News Cache (15-min TTL) ───────────────────────────────────────

const _newsCache  = new Map();
const NEWS_TTL_MS = 15 * 60 * 1000;

// ─── RSS Parser ───────────────────────────────────────────────────────────────

async function parseRssFeed(url, limit = 15) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'JARVIS/2.0' },
    signal:  AbortSignal.timeout(10000)
  });
  const xml = await resp.text();
  return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].slice(0, limit).map(m => {
    const b       = m[1];
    const title   = (b.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1] || '').trim();
    const link    = (b.match(/<link>(.*?)<\/link>/s)?.[1] || b.match(/<guid[^>]*>(https?[^<]+)<\/guid>/)?.[1] || '').trim();
    const desc    = (b.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s)?.[1] || '')
      .replace(/<[^>]+>/g, '').trim().slice(0, 200);
    const pubDate = (b.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '').trim();
    return { title, link, desc, pubDate };
  }).filter(i => i.title);
}

// ─── Get News for a Category ──────────────────────────────────────────────────

async function getNews(category) {
  const feedUrl = RSS_FEEDS[category] || RSS_FEEDS.tech;
  return parseRssFeed(feedUrl, 15);
}

// ─── Build News Context String (for AI prompt injection) ─────────────────────

async function getNewsSummaryContext(categories) {
  const cats = (categories && categories.length) ? categories : ['tech', 'world', 'business'];
  let context = '=== LIVE NEWS HEADLINES (fetched right now) ===\n';

  for (const cat of cats) {
    const cached = _newsCache.get(cat);
    let items;
    if (cached && Date.now() - cached.fetchedAt < NEWS_TTL_MS) {
      items = cached.items;
    } else {
      try {
        items = await parseRssFeed(RSS_FEEDS[cat] || RSS_FEEDS.tech, 8);
        _newsCache.set(cat, { items, fetchedAt: Date.now() });
      } catch { items = []; }
    }
    if (items.length) {
      context += `\n[${cat.toUpperCase()} NEWS]\n`;
      items.forEach((item, i) => {
        context += `${i + 1}. ${item.title}`;
        if (item.desc)    context += ` — ${item.desc.slice(0, 120)}`;
        if (item.pubDate) context += ` (${item.pubDate})`;
        context += '\n';
      });
    }
  }

  context += '\n=== END NEWS ===\n';
  return context;
}

module.exports = { getNews, getNewsSummaryContext, RSS_FEEDS };
