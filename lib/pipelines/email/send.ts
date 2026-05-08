/**
 * Email Send -- Gmail API send.
 * Only called after explicit user confirmation via draft card.
 */

import { getGmailAccessToken } from '../../services/gmailService';
import type { EmailDraft } from '../types';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Send an email via Gmail API.
 * Returns the sent message ID.
 */
export async function sendEmail(draft: EmailDraft): Promise<string> {
  const token = await getGmailAccessToken();
  if (!token) throw new Error('Gmail not connected');
  if (!draft.to) throw new Error('No recipient email address');

  // Build RFC 2822 message
  const messageParts = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    draft.body,
  ];

  if (draft.inReplyTo) {
    messageParts.splice(2, 0, `In-Reply-To: ${draft.inReplyTo}`);
    messageParts.splice(3, 0, `References: ${draft.inReplyTo}`);
  }

  const rawMessage = messageParts.join('\r\n');

  // Gmail API expects URL-safe base64 encoded message
  const encoded = btoa(rawMessage)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to send email: ${errText.slice(0, 200)}`);
  }

  const sent = await res.json();
  return sent.id || '';
}
