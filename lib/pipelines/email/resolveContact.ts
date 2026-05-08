/**
 * Resolve Contact -- find email address from a name.
 * Searches recent sent emails for the recipient.
 */

import { getGmailAccessToken } from '../../services/gmailService';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface ResolvedContact {
  name: string;
  email: string;
  confidence: number;
}

/**
 * Try to find an email address for a person by name.
 * Searches: 1) recent sent emails, 2) recent received emails.
 * Returns null if no match found (UI should prompt user for email).
 */
export async function resolveContact(name: string): Promise<ResolvedContact | null> {
  const token = await getGmailAccessToken();
  if (!token) return null;

  const nameLower = name.toLowerCase();

  // Search sent emails for this person
  const queries = [
    `from:me to:${name}`,     // emails I sent to this person
    `from:${name}`,           // emails from this person
  ];

  for (const query of queries) {
    try {
      const searchUrl = `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=5`;
      const searchRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!searchRes.ok) continue;
      const data = await searchRes.json();
      if (!data.messages?.length) continue;

      // Check first result for email address
      const msgId = data.messages[0].id;
      const msgUrl = `${GMAIL_API}/messages/${msgId}?format=metadata&metadataHeaders=To&metadataHeaders=From`;
      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!msgRes.ok) continue;
      const msg = await msgRes.json();
      const headers = msg.payload?.headers || [];

      // Extract email from the relevant header
      for (const header of headers) {
        const value = header.value || '';
        const emailMatch = value.match(/<([^>]+)>/) || value.match(/([^\s,]+@[^\s,]+)/);
        if (!emailMatch) continue;

        const email = emailMatch[1];
        // Check if the name appears near this email
        if (value.toLowerCase().includes(nameLower)) {
          return { name, email, confidence: 0.9 };
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}
