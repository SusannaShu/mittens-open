/**
 * Email Answer -- brain answers a question from email content.
 * Used for search_read flows.
 */

import { getBrain } from '../../brain/selector';
import type { EmailCandidate } from '../types';

/**
 * Answer a user's question based on email content.
 */
export async function answerFromEmails(
  emails: EmailCandidate[],
  question: string,
): Promise<string> {
  if (emails.length === 0) {
    return "I couldn't find any matching emails. Want to try different search terms?";
  }

  const brain = await getBrain();

  // Build context from emails (truncated to fit context window)
  const emailSummaries = emails
    .slice(0, 3) // max 3 emails for context
    .map((e, i) => `Email ${i + 1}:\nFrom: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n${e.cleanedBody || e.snippet}`)
    .join('\n---\n');

  const prompt = `Answer the user's question based on these emails.

Question: "${question}"

${emailSummaries}

Give a concise, direct answer. If the answer isn't clear from the emails, say so.`;

  const raw = await brain.text(prompt, { temperature: 0.3 });
  return raw.trim() || "I found the emails but couldn't determine the answer. Want me to show you the full content?";
}
