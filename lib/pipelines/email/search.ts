/**
 * Email Search -- Gmail API query builder + fetcher.
 * Code only, no AI.
 */

import { getGmailAccessToken } from '../../services/gmailService';
import type { EmailPlanResult, EmailCandidate } from '../types';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_RESULTS = 20;

/**
 * Build a Gmail search query string from plan parameters.
 */
function buildQuery(plan: EmailPlanResult): string {
  const parts: string[] = [];

  if (plan.search?.senders?.length) {
    const from = plan.search.senders.map(s => `from:${s}`).join(' OR ');
    parts.push(`(${from})`);
  }

  if (plan.search?.keywords?.length) {
    const kw = plan.search.keywords.join(' ');
    parts.push(kw);
  }

  if (plan.search?.subjectPatterns?.length) {
    const sub = plan.search.subjectPatterns.map(s => `subject:${s}`).join(' OR ');
    parts.push(`(${sub})`);
  }

  if (plan.search?.timeRange?.after) {
    // Gmail uses YYYY/MM/DD format
    parts.push(`after:${plan.search.timeRange.after.replace(/-/g, '/')}`);
  }

  if (plan.search?.timeRange?.before) {
    parts.push(`before:${plan.search.timeRange.before.replace(/-/g, '/')}`);
  }

  return parts.join(' ');
}

/**
 * Search Gmail and return matching email candidates.
 */
export async function searchEmails(plan: EmailPlanResult): Promise<EmailCandidate[]> {
  const token = await getGmailAccessToken();
  if (!token) throw new Error('Gmail not connected');

  const query = buildQuery(plan);
  if (!query.trim()) throw new Error('Empty search query');

  // Step 1: Search for message IDs
  const searchUrl = `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=${MAX_RESULTS}`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    if (searchRes.status === 401) throw new Error('Gmail token expired -- please reconnect');
    throw new Error(`Gmail search failed: ${errText.slice(0, 200)}`);
  }

  const searchData = await searchRes.json();
  const messageIds: Array<{ id: string; threadId: string }> = searchData.messages || [];

  if (messageIds.length === 0) return [];

  // Step 2: Fetch metadata for each message (batch-friendly)
  const candidates: EmailCandidate[] = [];

  for (const { id, threadId } of messageIds) {
    try {
      const msgUrl = `${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!msgRes.ok) continue;
      const msg = await msgRes.json();

      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      candidates.push({
        id,
        threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        snippet: msg.snippet || '',
      });
    } catch {
      // Skip failed individual fetches
    }
  }

  return candidates;
}

/**
 * Get the total count of search results (for stats).
 */
export function getSearchQuery(plan: EmailPlanResult): string {
  return buildQuery(plan);
}
