/**
 * Extract Event -- brain pulls calendar event data from email content.
 * Used for search_read_act -> add_to_calendar flows.
 */

import { getBrain } from '../../brain/selector';
import type { EmailCandidate, EmailExtractedEvent } from '../types';

/**
 * Extract a calendar event from email content.
 */
export async function extractEvent(emails: EmailCandidate[]): Promise<EmailExtractedEvent | null> {
  if (emails.length === 0) return null;

  const brain = await getBrain();

  const emailContext = emails
    .slice(0, 2)
    .map(e => `From: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n${e.cleanedBody || e.snippet}`)
    .join('\n---\n');

  const today = new Date().toISOString().split('T')[0];

  const prompt = `Extract a calendar event from these emails.

${emailContext}

Today is ${today}.
Return JSON: {"title":"event title","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","location":"string","participants":["name"]}

If "sunday" / "monday" etc., resolve to the next occurrence from today.
If no clear event found, return null.`;

  const raw = await brain.text(prompt, { temperature: 0.1 });

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    if (!parsed.title || !parsed.date) return null;

    return {
      title: parsed.title,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      location: parsed.location,
      participants: parsed.participants,
    };
  } catch {
    return null;
  }
}
