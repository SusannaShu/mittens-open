/**
 * Feed Parser -- lightweight RSS/Atom parser (code only, no AI).
 *
 * Tries common feed URLs for a given base URL, parses XML via regex.
 * No npm dependency -- string parsing only (React Native compatible).
 */

import type { WatchFetchedItem } from '../types';
import { hashItem } from './items';

const FEED_PATHS = ['/rss', '/feed', '/atom.xml', '/rss.xml', '/feed.xml', '/index.xml'];
const MAX_ITEMS = 30;

/**
 * Try to find and parse an RSS/Atom feed for the given URL.
 * Returns null if no feed is found.
 */
export async function tryParseFeed(baseUrl: string): Promise<WatchFetchedItem[] | null> {
  // Normalize URL
  const base = baseUrl.replace(/\/+$/, '');

  // Try the URL itself first (might already be a feed URL)
  const directResult = await fetchAndParse(base);
  if (directResult) return directResult;

  // Try common feed paths
  for (const path of FEED_PATHS) {
    const feedUrl = `${base}${path}`;
    const result = await fetchAndParse(feedUrl);
    if (result) return result;
  }

  return null;
}

async function fetchAndParse(url: string): Promise<WatchFetchedItem[] | null> {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    // Quick check: is this XML with feed markers?
    if (!text.includes('<rss') && !text.includes('<feed') && !text.includes('<channel')) {
      // Not a feed -- might be an HTML page
      if (contentType.includes('html')) return null;
      // Could still be XML, check for item/entry tags
      if (!text.includes('<item') && !text.includes('<entry')) return null;
    }

    return parseXml(text, url);
  } catch {
    return null;
  }
}

/**
 * Parse RSS 2.0 or Atom feed XML into WatchFetchedItem[].
 * Uses regex extraction -- intentionally simple.
 */
function parseXml(xml: string, sourceUrl: string): WatchFetchedItem[] | null {
  const isAtom = xml.includes('<feed') && xml.includes('<entry');
  const items: WatchFetchedItem[] = [];

  if (isAtom) {
    // Atom: <entry>...</entry>
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const entry of entries.slice(0, MAX_ITEMS)) {
      const title = extractTag(entry, 'title');
      const link = extractAtomLink(entry);
      const summary = extractTag(entry, 'summary') || extractTag(entry, 'content');
      const published = extractTag(entry, 'published') || extractTag(entry, 'updated');
      const author = extractTag(entry, 'name'); // inside <author><name>

      if (!title) continue;
      items.push({
        id: hashItem(title, link || sourceUrl),
        sourceUrl,
        title: truncate(stripTags(title), 100),
        url: link || undefined,
        body: truncate(stripTags(summary || ''), 200),
        author: author || undefined,
        publishedAt: published || undefined,
      });
    }
  } else {
    // RSS 2.0: <item>...</item>
    const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    for (const item of rssItems.slice(0, MAX_ITEMS)) {
      const title = extractTag(item, 'title');
      const link = extractTag(item, 'link');
      const desc = extractTag(item, 'description');
      const pubDate = extractTag(item, 'pubDate');
      const author = extractTag(item, 'author') || extractTag(item, 'dc:creator');

      if (!title) continue;
      items.push({
        id: hashItem(title, link || sourceUrl),
        sourceUrl,
        title: truncate(stripTags(title), 100),
        url: link || undefined,
        body: truncate(stripTags(desc || ''), 200),
        author: author || undefined,
        publishedAt: pubDate || undefined,
      });
    }
  }

  return items.length > 0 ? items : null;
}

/** Extract text content between XML tags. */
function extractTag(xml: string, tag: string): string | null {
  // Handle CDATA
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : null;
}

/** Extract href from Atom <link> element. */
function extractAtomLink(entry: string): string | null {
  // <link href="..." /> or <link rel="alternate" href="..." />
  const match = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/i);
  return match ? match[1] : null;
}

/** Strip HTML tags from text. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}
