/**
 * Email Compose -- brain writes email content.
 * Always returns a draft for user review, never auto-sends.
 */

import { getBrain } from '../../brain/selector';
import type { EmailDraft, EmailPlanResult } from '../types';

/**
 * Compose an email draft from the user's intent.
 */
export async function composeEmail(plan: EmailPlanResult): Promise<EmailDraft> {
  const brain = await getBrain();

  const recipientName = plan.recipient?.name || 'the recipient';
  const intent = plan.messageIntent || 'a message';

  const prompt = `Write a short, natural email.

To: ${recipientName}${plan.recipient?.emailHint ? ` (${plan.recipient.emailHint})` : ''}
Intent: "${intent}"

Return JSON: {"subject":"string","body":"string"}

Rules:
- Keep it brief and natural, like a real person would write
- Match the tone to the intent (casual for friends, professional for work)
- Don't add unnecessary fluff or formality
- Sign off naturally (no "Best regards" unless professional)`;

  const raw = await brain.text(prompt, { temperature: 0.5 });

  return parseDraftResponse(raw, plan);
}

function parseDraftResponse(raw: string, plan: EmailPlanResult): EmailDraft {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        to: plan.recipient?.emailHint || '',
        subject: parsed.subject || plan.messageIntent || '',
        body: parsed.body || '',
      };
    }
  } catch {
    // Fallback: use raw text as body
  }

  return {
    to: plan.recipient?.emailHint || '',
    subject: plan.messageIntent || 'Message from Mittens',
    body: raw.trim(),
  };
}
