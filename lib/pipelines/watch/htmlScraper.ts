/**
 * HTML Scraper -- lightweight HTML-to-items extraction (code only, no AI).
 *
 * Fetches a webpage and splits it into individual items.
 * Each item is just { title, snippet, url } -- the brain never sees raw HTML.
 *
 * Strategy:
 *   1. Strip scripts, styles, nav, footer
 *   2. Look for repeated patterns: <h2>+<p>, <li><a>, <article>, <div class="post">
 *   3. Each pattern match = one WatchFetchedItem
 *   4. Title capped at 100 chars, snippet at 200 chars
 */

import type { WatchFetchedItem } from '../types';
import { hashItem } from './items';

const MAX_ITEMS = 30;

/**
 * Fetch a webpage and extract content items.
 * Returns pre-split items -- never raw HTML.
 */
export async function scrapeHtml(url: string): Promise<WatchFetchedItem[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MittensBot/1.0)',
      'Accept': 'text/html',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }

  const html = await res.text();
  return extractItems(html, url);
}

function extractItems(html: string, sourceUrl: string): WatchFetchedItem[] {
  // Strip noise: scripts, styles, nav, footer, header, aside
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const items: WatchFetchedItem[] = [];

  // Strategy 1: <article> blocks
  const articles = cleaned.match(/<article[\s\S]*?<\/article>/gi) || [];
  if (articles.length > 0) {
    for (const article of articles.slice(0, MAX_ITEMS)) {
      const item = parseBlock(article, sourceUrl);
      if (item) items.push(item);
    }
    if (items.length > 0) return items;
  }

  // Strategy 2: heading + following paragraph pairs
  const headingPairs = cleaned.match(/<h[2-3][^>]*>[\s\S]*?<\/h[2-3]>[\s\S]*?(?=<h[2-3]|$)/gi) || [];
  if (headingPairs.length > 1) {
    for (const block of headingPairs.slice(0, MAX_ITEMS)) {
      const item = parseBlock(block, sourceUrl);
      if (item) items.push(item);
    }
    if (items.length > 0) return items;
  }

  // Strategy 3: list items with links (<li><a>)
  const listLinks = cleaned.match(/<li[^>]*>[\s\S]*?<a[^>]*href="[^"]*"[^>]*>[\s\S]*?<\/li>/gi) || [];
  if (listLinks.length > 2) {
    for (const li of listLinks.slice(0, MAX_ITEMS)) {
      const link = extractHref(li);
      const title = stripTags(li);
      if (!title || title.length < 5) continue;

      items.push({
        id: hashItem(title, link || sourceUrl),
        sourceUrl,
        title: truncate(title, 100),
        url: resolveUrl(link, sourceUrl) || undefined,
        body: '',
      });
    }
    if (items.length > 0) return items;
  }

  // Strategy 4: fall back to <p> blocks as individual items
  const paragraphs = cleaned.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  const meaningfulPs = paragraphs
    .map(p => stripTags(p))
    .filter(t => t.length > 30);

  for (const text of meaningfulPs.slice(0, MAX_ITEMS)) {
    const title = text.length > 100 ? text.slice(0, 97) + '...' : text;
    items.push({
      id: hashItem(title, sourceUrl),
      sourceUrl,
      title,
      body: truncate(text, 200),
    });
  }

  return items;
}

/** Parse an HTML block into a single item. */
function parseBlock(block: string, sourceUrl: string): WatchFetchedItem | null {
  // Extract first heading as title
  const headingMatch = block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const title = headingMatch ? stripTags(headingMatch[1]) : '';

  // Extract first link
  const link = extractHref(block);

  // Extract text content as snippet (minus the heading)
  const bodyHtml = headingMatch
    ? block.replace(headingMatch[0], '')
    : block;
  const body = stripTags(bodyHtml);

  if (!title && !body) return null;

  return {
    id: hashItem(title || body, link || sourceUrl),
    sourceUrl,
    title: truncate(title || body, 100),
    url: resolveUrl(link, sourceUrl) || undefined,
    body: truncate(body, 200),
  };
}

function extractHref(html: string): string | null {
  const match = html.match(/href="([^"]*?)"/i);
  return match ? match[1] : null;
}

function resolveUrl(href: string | null, base: string): string | null {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  try {
    // Handle relative URLs
    const baseUrl = new URL(base);
    if (href.startsWith('/')) return `${baseUrl.origin}${href}`;
    return `${baseUrl.origin}/${href}`;
  } catch {
    return href;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}
