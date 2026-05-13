/**
 * ambient/voiceDispatchHelpers.ts -- Context builders and action executors
 * for the pendant voice dispatch pipeline.
 *
 * Separated from pendantVoiceDispatch.ts for file size.
 */

import { getDb } from '../../database';
import { getBrain } from '../../brain/selector';

// ─── Types ────

export interface DispatchResult {
  action: 'create' | 'update' | 'clarify' | 'respond';
  response: string;
  data?: Record<string, any>;
  targetLogId?: number;
}

// ─── Context Builders ────

export function buildMealContext(): string {
  try {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];
    const rows = db.getAllSync(
      `SELECT id, logged_at, log_name, items, source
       FROM nutrition_logs
       WHERE date(logged_at) = ? AND deleted_at IS NULL
       ORDER BY logged_at ASC`,
      [today],
    ) as any[];

    if (!rows || rows.length === 0) return 'No meals logged today.';

    return rows.map(r => {
      const time = new Date(r.logged_at).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
      const src = r.source === 'voice' ? 'voice' : r.source === 'pendant' ? 'camera' : r.source;
      return `- ${time}: ${r.log_name || 'unnamed'} (id:${r.id}, source:${src})`;
    }).join('\n');
  } catch {
    return 'Could not load meal history.';
  }
}

export function buildActivityContext(): string {
  try {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];
    const rows = db.getAllSync(
      `SELECT id, logged_at, log_name, activity_type, duration_min,
              engagement, energy, source
       FROM activity_logs
       WHERE date(logged_at) = ? AND deleted_at IS NULL
       ORDER BY logged_at ASC`,
      [today],
    ) as any[];

    if (!rows || rows.length === 0) return 'No activities logged today.';

    return rows.map(r => {
      const time = new Date(r.logged_at).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
      const eng = r.engagement != null ? ` eng:${r.engagement}` : '';
      const ene = r.energy != null ? ` ene:${r.energy}` : '';
      return `- ${time}: ${r.log_name || r.activity_type} (${r.duration_min || '?'}min, id:${r.id}${eng}${ene})`;
    }).join('\n');
  } catch {
    return 'Could not load activity history.';
  }
}

// ─── Prompt Builders ────

export function buildMealPrompt(transcript: string | null, context: string): string {
  return [
    'You are Mittens, an AI pendant. The user spoke about food.',
    'Here are today\'s meals:',
    context,
    '',
    `User said: "${transcript}"`,
    '',
    'Decide: create a new meal log, update an existing one, or ask for clarification.',
    'Return ONLY JSON:',
    '{ "action": "create"|"update"|"clarify",',
    '  "response": "natural conversational response to speak",',
    '  "targetLogId": number (for update only),',
    '  "data": { "items": [{"name":"...", "quantity":1}], "logName": "..." } }',
    '',
    'If a similar item was already logged recently and the request is ambiguous,',
    'use action "clarify" and ask about it conversationally.',
  ].join('\n');
}

export function buildActivityPrompt(transcript: string | null, context: string): string {
  return [
    'You are Mittens, an AI pendant. The user is commenting on an activity.',
    'Here are today\'s activities:',
    context,
    '',
    `User said: "${transcript}"`,
    '',
    'Decide which activity log to update and what fields to change.',
    'Return ONLY JSON:',
    '{ "action": "update"|"respond",',
    '  "response": "natural conversational response to speak",',
    '  "targetLogId": number,',
    '  "updates": { "engagement": 1-10, "energy": 1-10 } }',
    '',
    'engagement = how absorbed/engaged (1=bored, 10=flow state)',
    'energy = how energized (1=drained, 10=buzzing)',
    'Only include fields the user mentioned or implied.',
  ].join('\n');
}

// ─── JSON Parsers ────

export function parseDispatchResponse(raw: string): DispatchResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action || 'respond',
        response: parsed.response || 'Done.',
        data: parsed.data,
        targetLogId: parsed.targetLogId,
      };
    }
  } catch { /* parse failed */ }
  return { action: 'respond', response: 'I heard you but had trouble processing that.' };
}

// ─── Meal Action Executor ────

export async function executeMealAction(
  result: DispatchResult,
): Promise<{ response: string; action: string; logId?: number | null }> {
  // Clarification needed -- use mittensAsk
  if (result.action === 'clarify') {
    try {
      const { mittensAsk } = require('./mittensAsk');
      const answer = await mittensAsk(result.response);
      if (answer) {
        const brain = await getBrain();
        const context = buildMealContext();
        const followUpPrompt = [
          'Continue from the meal clarification.',
          'Meals today:', context,
          `User clarified: "${answer}"`,
          'Return JSON: { "action": "create"|"update", "response": "...", "data": {...} }',
        ].join('\n');
        const raw = await brain.text(followUpPrompt);
        const followUp = parseDispatchResponse(raw);
        return executeMealAction(followUp);
      }
      return { response: 'No worries, I will skip that for now.', action: 'respond' };
    } catch {
      return { response: result.response, action: 'clarify' };
    }
  }

  const db = getDb();
  const items = result.data?.items || [];
  const logName = result.data?.logName || items.map((i: any) => i.name).join(', ') || 'unnamed';

  if (result.action === 'update' && result.targetLogId) {
    try {
      const existing = db.getFirstSync(
        'SELECT items FROM nutrition_logs WHERE id = ?',
        [result.targetLogId],
      ) as any;
      const existingItems = existing?.items ? JSON.parse(existing.items) : [];
      const merged = [...existingItems, ...items];

      db.runSync(
        `UPDATE nutrition_logs SET items = ?, log_name = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(merged), logName, result.targetLogId],
      );
      return { response: result.response, action: 'update', logId: result.targetLogId };
    } catch {
      return { response: 'I had trouble updating that meal log.', action: 'respond' };
    }
  }

  // Create new log
  try {
    const insertResult = db.runSync(
      `INSERT INTO nutrition_logs (
        logged_at, meal_type, log_name, items, source,
        entry_type, created_at, updated_at
      ) VALUES (?, 'snack', ?, ?, 'voice', 'food', datetime('now'), datetime('now'))`,
      [new Date().toISOString(), logName, JSON.stringify(items)],
    );
    const logId = insertResult?.lastInsertRowId ?? null;
    return { response: result.response, action: 'create', logId };
  } catch {
    return { response: 'I had trouble creating that meal log.', action: 'respond' };
  }
}

// ─── Activity Action Executor ────

export function executeActivityAction(
  raw: string,
): { response: string; action: string; logId?: number | null } {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { response: 'I heard you but had trouble processing that.', action: 'respond' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.action === 'update' && parsed.targetLogId && parsed.updates) {
      const db = getDb();
      const sets: string[] = [];
      const vals: any[] = [];

      if (parsed.updates.engagement != null) {
        sets.push('engagement = ?');
        vals.push(parsed.updates.engagement);
      }
      if (parsed.updates.energy != null) {
        sets.push('energy = ?');
        vals.push(parsed.updates.energy);
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        vals.push(parsed.targetLogId);
        db.runSync(
          `UPDATE activity_logs SET ${sets.join(', ')} WHERE id = ?`,
          vals,
        );
        console.log(`[VoiceDispatch] Updated activity #${parsed.targetLogId}:`, parsed.updates);
      }
    }

    return {
      response: parsed.response || 'Updated.',
      action: parsed.action || 'respond',
      logId: parsed.targetLogId,
    };
  } catch (err: any) {
    console.warn('[VoiceDispatch] Activity update parse failed:', err?.message);
    return { response: 'I had trouble updating that activity.', action: 'respond' };
  }
}
