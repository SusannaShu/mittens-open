/**
 * Email Plan -- Phase 1 (brain).
 *
 * Takes the user's natural language request and decides:
 *   1. What type of email action to perform
 *   2. Search strategy (keywords, senders, time range)
 *   3. Downstream actions (calendar, reply, etc.)
 *   4. Recipient info (for compose/send)
 */

import { getBrain } from '../../brain/selector';
import type { PipelineInput } from '../runner';
import type { EmailPlanResult, EmailActionType } from '../types';

export async function planEmailAction(input: PipelineInput): Promise<EmailPlanResult> {
  const brain = await getBrain();

  const prompt = `User wants to do something with email. Classify and extract params.

Input: "${input.text || ''}"

Return JSON:
{
  "action": "search_orders" | "search_read" | "search_read_act" | "compose_send",
  "search": { "k": ["keywords"], "s": ["sender@email.com"], "t": { "after": "YYYY-MM-DD", "before": "YYYY-MM-DD" } },
  "downstream": "add_to_calendar" | "reply" | "forward" | null,
  "recipient": { "name": "string", "email": "hint@email.com" } | null,
  "msgIntent": "what to say" | null,
  "question": "what to answer" | null,
  "cat": "fashion" | "tech" | "food" | "general"
}

Rules:
- "find orders" / "show purchases" / "receipts" = search_orders
- "check email from X about Y" / "what did X say" = search_read
- "add to calendar" / "reply to" / "forward" = search_read_act
- "send email to X saying Y" / "email X about Y" = compose_send
- For time: "recent" = last 30 days, "last month" = previous month
- For senders: infer email domains from app names (depop -> noreply@depop.com)`;

  const raw = await brain.text(prompt, { temperature: 0.1 });

  return parsePlanResponse(raw);
}

function parsePlanResponse(raw: string): EmailPlanResult {
  const defaults: EmailPlanResult = {
    actionType: 'search_read',
    search: { keywords: [] },
    confidence: 0.5,
  };

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return defaults;
    const parsed = JSON.parse(match[0]);

    const actionMap: Record<string, EmailActionType> = {
      search_orders: 'search_orders',
      search_read: 'search_read',
      search_read_act: 'search_read_act',
      compose_send: 'compose_send',
    };

    const result: EmailPlanResult = {
      actionType: actionMap[parsed.action] || 'search_read',
      confidence: 0.85,
    };

    // Parse search strategy
    if (parsed.search) {
      result.search = {
        keywords: parsed.search.k || parsed.search.keywords || [],
        senders: parsed.search.s || parsed.search.senders,
        subjectPatterns: parsed.search.sp || parsed.search.subjectPatterns,
        timeRange: parsed.search.t || parsed.search.timeRange,
      };
    }

    if (parsed.downstream) result.downstreamAction = parsed.downstream;
    if (parsed.recipient) {
      result.recipient = {
        name: parsed.recipient.name,
        emailHint: parsed.recipient.email,
      };
    }
    if (parsed.msgIntent) result.messageIntent = parsed.msgIntent;
    if (parsed.question) result.question = parsed.question;
    if (parsed.cat) result.category = parsed.cat;

    return result;
  } catch {
    return defaults;
  }
}
