/**
 * Watch Fetch -- Phase 2 (code only, no AI).
 *
 * Dispatcher that routes to the right fetcher based on platform.
 * Always returns pre-split WatchFetchedItem[] -- the brain never
 * sees raw HTML or API responses.
 *
 * Fetch strategies (auto-detected):
 *   1. Known API -- HN Firebase, arXiv Atom, Reddit JSON
 *   2. RSS/Atom -- try common feed paths
 *   3. HTML scrape -- fallback, splits page into items
 */

import type { WatchPlanResult, WatchFetchedItem } from '../types';
import { tryParseFeed } from './feedParser';
import { scrapeHtml } from './htmlScraper';
import { hashItem, getRecentItemHashes } from './items';

/**
 * Fetch content from all planned sources.
 * Returns flattened list of pre-split items.
 */
export async function fetchWatchContent(
  plan: WatchPlanResult,
): Promise<WatchFetchedItem[]> {
  const allItems: WatchFetchedItem[] = [];

  for (const source of plan.sources) {
    try {
      let items: WatchFetchedItem[];

      // Route to the right fetcher
      switch (source.platform) {
        case 'hackernews':
          items = await fetchHackerNews();
          break;
        case 'arxiv':
          items = await fetchArxiv(source.url);
          break;
        case 'reddit':
          items = await fetchReddit(source.url);
          break;
        default:
          if (source.type === 'ig_stories') {
            items = await fetchIgStories(source.handle || '');
          } else {
            items = await fetchGenericWeb(source.url);
          }
      }

      allItems.push(...items);
    } catch (err: any) {
      console.error(`[Watch] Fetch failed for ${source.url}:`, err?.message);
      // Continue with other sources
    }
  }

  // Dedup against recently shown items
  return dedup(allItems);
}

// ─── Known API Fetchers ───

async function fetchHackerNews(): Promise<WatchFetchedItem[]> {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  if (!res.ok) throw new Error(`HN API failed: ${res.status}`);

  const ids: number[] = await res.json();
  const top = ids.slice(0, 30);

  // Fetch story details in parallel (batched)
  const items: WatchFetchedItem[] = [];
  const batchSize = 10;

  for (let i = 0; i < top.length; i += batchSize) {
    const batch = top.slice(i, i + batchSize);
    const stories = await Promise.all(
      batch.map(async (id) => {
        try {
          const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          if (!storyRes.ok) return null;
          return storyRes.json();
        } catch {
          return null;
        }
      }),
    );

    for (const story of stories) {
      if (!story || !story.title) continue;
      items.push({
        id: hashItem(story.title, story.url || `hn:${story.id}`),
        sourceUrl: 'https://news.ycombinator.com',
        title: truncate(story.title, 100),
        url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
        body: '', // HN titles are self-contained
        author: story.by || undefined,
        publishedAt: story.time ? new Date(story.time * 1000).toISOString() : undefined,
        meta: {
          points: story.score || 0,
          comments: story.descendants || 0,
          hnId: story.id,
        },
      });
    }
  }

  return items;
}

async function fetchArxiv(url: string): Promise<WatchFetchedItem[]> {
  // arXiv provides Atom feeds -- delegate to feed parser
  // Transform list URL to API URL if needed
  const apiUrl = url.includes('/api/')
    ? url
    : url.replace('arxiv.org/list/', 'export.arxiv.org/api/query?search_query=cat:')
         .replace('/recent', '&sortBy=submittedDate&sortOrder=descending&max_results=30');

  const feedResult = await tryParseFeed(apiUrl);
  if (feedResult) return feedResult;

  // Direct API fallback
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`arXiv API failed: ${res.status}`);

  const xml = await res.text();
  // arXiv API returns Atom, tryParseFeed handles Atom
  const parsed = await tryParseFeed(apiUrl);
  return parsed || [];
}

async function fetchReddit(url: string): Promise<WatchFetchedItem[]> {
  // Reddit JSON API: append .json
  const jsonUrl = url.replace(/\/?$/, '/.json');
  const res = await fetch(jsonUrl, {
    headers: { 'User-Agent': 'MittensBot/1.0' },
  });
  if (!res.ok) throw new Error(`Reddit API failed: ${res.status}`);

  const data = await res.json();
  const posts = data?.data?.children || [];
  const items: WatchFetchedItem[] = [];

  for (const post of posts.slice(0, 30)) {
    const d = post.data;
    if (!d || !d.title) continue;

    items.push({
      id: hashItem(d.title, d.permalink),
      sourceUrl: url,
      title: truncate(d.title, 100),
      url: d.url || `https://reddit.com${d.permalink}`,
      body: truncate(d.selftext || '', 200),
      author: d.author || undefined,
      publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
      meta: {
        score: d.score || 0,
        comments: d.num_comments || 0,
        subreddit: d.subreddit,
      },
    });
  }

  return items;
}

async function fetchIgStories(_handle: string): Promise<WatchFetchedItem[]> {
  // IG stories require Backend endpoint (Instaloader) -- deferred
  // For now, return empty with a note
  console.log('[Watch] IG stories fetch not yet implemented (needs Backend endpoint)');
  return [];
}

// ─── Generic Web Fetcher ───

async function fetchGenericWeb(url: string): Promise<WatchFetchedItem[]> {
  // Try RSS/Atom first
  const feedResult = await tryParseFeed(url);
  if (feedResult && feedResult.length > 0) return feedResult;

  // Fall back to HTML scrape
  return scrapeHtml(url);
}

// ─── Dedup ───

async function dedup(items: WatchFetchedItem[]): Promise<WatchFetchedItem[]> {
  const recentHashes = getRecentItemHashes(24);
  const seen = new Set(recentHashes);

  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}
