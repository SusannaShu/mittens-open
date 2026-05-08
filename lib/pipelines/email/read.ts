/**
 * Email Read -- fetch full email content and sanitize HTML.
 * Code only, no AI. Combines fetch + sanitize.
 */

import { getGmailAccessToken } from '../../services/gmailService';
import type { EmailCandidate } from '../types';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Fetch and clean the full body of an email by ID.
 * Returns the candidate with cleanedBody populated.
 */
export async function readEmail(candidate: EmailCandidate): Promise<EmailCandidate> {
  const token = await getGmailAccessToken();
  if (!token) throw new Error('Gmail not connected');

  const url = `${GMAIL_API}/messages/${candidate.id}?format=full`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Failed to fetch email ${candidate.id}`);
  const msg = await res.json();

  const rawBody = extractBody(msg.payload);
  const cleaned = sanitizeHtml(rawBody);

  return { ...candidate, cleanedBody: cleaned };
}

/**
 * Read multiple emails. Stops after maxReads to avoid rate limits.
 */
export async function readEmails(
  candidates: EmailCandidate[],
  maxReads = 5,
): Promise<EmailCandidate[]> {
  const results: EmailCandidate[] = [];
  const toRead = candidates.slice(0, maxReads);

  for (const candidate of toRead) {
    try {
      const read = await readEmail(candidate);
      results.push(read);
    } catch {
      // Skip failed reads, keep the candidate with snippet only
      results.push(candidate);
    }
  }

  return results;
}

// ── Body Extraction ──

/**
 * Extract text body from Gmail message payload.
 * Handles multipart messages (text/plain preferred, text/html fallback).
 */
function extractBody(payload: any): string {
  if (!payload) return '';

  // Direct body
  if (payload.body?.data) {
    return base64Decode(payload.body.data);
  }

  // Multipart: look for text/plain first, then text/html
  if (payload.parts) {
    // Try text/plain
    const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return base64Decode(textPart.body.data);
    }

    // Try text/html
    const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return base64Decode(htmlPart.body.data);
    }

    // Nested multipart (multipart/alternative inside multipart/mixed)
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

/**
 * Decode Gmail's URL-safe base64 encoding.
 */
function base64Decode(data: string): string {
  try {
    // Gmail uses URL-safe base64 (replace - with +, _ with /)
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return atob(base64);
  } catch {
    return data;
  }
}

// ── HTML Sanitization ──

/**
 * Strip HTML to clean text. Regex-based (no DOM in React Native).
 * Focuses on extracting readable content from order confirmation emails.
 */
function sanitizeHtml(html: string): string {
  if (!html) return '';

  let text = html;

  // Remove <style> and <script> blocks entirely
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Remove tracking pixels (1x1 images, beacon URLs)
  text = text.replace(/<img[^>]*(?:width|height)\s*=\s*["']?1["']?[^>]*>/gi, '');
  text = text.replace(/<img[^>]*(?:tracking|beacon|pixel|open)[^>]*>/gi, '');

  // Remove unsubscribe and footer blocks
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Convert common HTML entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

  // Convert <br> and block elements to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(?:p|div|tr|li|h[1-6]|td)>/gi, '\n');
  text = text.replace(/<(?:p|div|tr|li|h[1-6])[\s>]/gi, '\n');

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');           // collapse horizontal whitespace
  text = text.replace(/\n{3,}/g, '\n\n');         // max 2 consecutive newlines
  text = text.replace(/^\s+|\s+$/gm, '');         // trim each line

  // Truncate to ~500 chars to stay within brain context limits
  if (text.length > 500) {
    text = text.slice(0, 500) + '...';
  }

  return text.trim();
}
