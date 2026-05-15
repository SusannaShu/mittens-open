/**
 * Pipeline Logger -- tracks phase-by-phase execution for debugging.
 *
 * Records timing, status, and result summaries for each phase
 * so you can see exactly what happened during a pipeline run.
 *
 * Attached to reply messages for post-hoc inspection in the chat UI.
 */

export interface PhaseLog {
  domain: string;
  phase: string;
  status: 'running' | 'complete' | 'error' | 'skipped';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  /** Short summary of what this phase produced */
  resultSummary?: string;
  error?: string;
  /** Prompt / context sent to the brain (for debug trace) */
  input?: string;
  /** Raw response from the brain (for debug trace) */
  output?: string;
}

export interface PipelineLog {
  /** When the entire pipeline run started */
  startedAt: number;
  /** When the entire pipeline run finished */
  completedAt?: number;
  totalDurationMs?: number;
  /** Which brain was used */
  brainId?: string;
  /** Triage result summary */
  triageSummary?: string;
  /** Per-phase logs in chronological order */
  phases: PhaseLog[];
}

/**
 * Mutable logger instance -- created per pipeline run.
 * Call startPhase / completePhase / failPhase as phases execute.
 */
export class PipelineLogger {
  private log: PipelineLog;

  constructor(brainId?: string) {
    this.log = {
      startedAt: Date.now(),
      brainId,
      phases: [],
    };
  }

  setTriageSummary(summary: string) {
    this.log.triageSummary = summary;
  }

  startPhase(domain: string, phase: string): number {
    const index = this.log.phases.length;
    this.log.phases.push({
      domain,
      phase,
      status: 'running',
      startedAt: Date.now(),
    });
    return index;
  }

  completePhase(index: number, resultSummary?: string) {
    const entry = this.log.phases[index];
    if (!entry) return;
    entry.status = 'complete';
    entry.completedAt = Date.now();
    entry.durationMs = entry.completedAt - entry.startedAt;
    if (resultSummary) entry.resultSummary = resultSummary;
  }

  failPhase(index: number, error: string) {
    const entry = this.log.phases[index];
    if (!entry) return;
    entry.status = 'error';
    entry.completedAt = Date.now();
    entry.durationMs = entry.completedAt - entry.startedAt;
    entry.error = error;
  }

  skipPhase(domain: string, phase: string, reason?: string) {
    this.log.phases.push({
      domain,
      phase,
      status: 'skipped',
      startedAt: Date.now(),
      completedAt: Date.now(),
      durationMs: 0,
      resultSummary: reason || 'Skipped (data already provided)',
    });
  }

  finalize(): PipelineLog {
    this.log.completedAt = Date.now();
    this.log.totalDurationMs = this.log.completedAt - this.log.startedAt;
    return this.log;
  }

  /** Record what was sent to and received from the brain */
  logPhaseIO(index: number, input: string, output: string) {
    const entry = this.log.phases[index];
    if (!entry) return;
    entry.input = input;
    entry.output = output;
  }

  /** Get a snapshot of the current log (for live updates) */
  snapshot(): PipelineLog {
    return { ...this.log, phases: [...this.log.phases] };
  }
}

/** Format a duration for display */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(1);
  return `${secs}s`;
}

/** Summarize result data into a short string for the log */
export function summarizeResult(domain: string, phase: string, data: any): string {
  if (!data) return 'No result';

  try {
    switch (`${domain}:${phase}`) {
      // Triage
      case 'triage:classify':
        if (data.intents) return `${data.intents.length} intent(s): ${data.intents.map((i: any) => i.pipeline).join(', ')}`;
        return JSON.stringify(data).slice(0, 80);

      // Chat pipeline
      case 'chat:classify':
        if (data.directReply) return `Direct reply (no data needed)`;
        if (data.dataNeeded?.length) return `Needs: ${data.dataNeeded.join(', ')}`;
        return 'No data needed';
      case 'chat:respond':
        if (data.reply) return `"${data.reply.slice(0, 60)}${data.reply.length > 60 ? '...' : ''}"`;
        return 'Empty reply';
      case 'chat:sideEffects':
        const parts: string[] = [];
        if (data.memoryUpdates?.length) parts.push(`${data.memoryUpdates.length} memory update(s)`);
        if (data.pantryUpdate) parts.push('pantry update');
        if (data.failureLog) parts.push('failure logged');
        return parts.length > 0 ? parts.join(', ') : 'No side effects';

      // Activity pipeline
      case 'activity:detect':
        if (data.logName) return `${data.logName} (${data.activityType}, ${data.duration_min}min)`;
        return JSON.stringify(data).slice(0, 80);
      case 'activity:environment':
        if (data.environment) return `${data.environment}${data.subtype ? ` / ${data.subtype}` : ''}`;
        return JSON.stringify(data).slice(0, 80);
      case 'activity:social':
        if (data.interactions) return data.interactions;
        return JSON.stringify(data).slice(0, 80);
      case 'activity:objects':
        if (data.objects) return `${data.objects.length} object(s) found`;
        return JSON.stringify(data).slice(0, 80);
      case 'activity:lifeDesign':
        if (data.lifeCategories) {
          const lc = data.lifeCategories;
          return `W:${lc.work} H:${lc.health} P:${lc.play} L:${lc.love}`;
        }
        return JSON.stringify(data).slice(0, 80);

      // Food pipeline
      case 'food:eatingContext':
        if (data.foods) return `${data.foods.length} food(s): ${data.foods.map((f: any) => f.name).join(', ')}`;
        return JSON.stringify(data).slice(0, 80);

      // Pantry
      case 'pantry:identify':
        if (data.items) return `${data.items.length} item(s)`;
        return JSON.stringify(data).slice(0, 80);
      case 'pantry:freshness':
        return `${data.freshness || 'unknown'} (${data.storageLocation || '?'})`;

      // Sleep
      case 'sleep:detect':
        if (data.totalMinutes) return `${Math.floor(data.totalMinutes / 60)}h ${data.totalMinutes % 60}m, quality: ${data.quality || '?'}`;
        return JSON.stringify(data).slice(0, 80);

      // Watch
      case 'watch:plan':
        return `${data.sources?.length || 0} source(s), filter: "${(data.filter || '').slice(0, 40)}"`;
      case 'watch:fetch':
        return `${data?.length || 0} item(s) fetched`;
      case 'watch:filter':
        return `${data.kept?.length || 0} kept, ${data.skipped?.length || 0} skipped`;
      case 'watch:extract':
        return `${data?.length || 0} item(s) extracted`;

      // Ambient pipeline (dual classifier)
      case 'gate:quality':
        return data.reason || (data.skip ? 'Skipped' : 'Passed');
      case 'classify:dual':
        return data.description || JSON.stringify(data).slice(0, 80);
      case 'log:write':
        return data.logIds || data.resultSummary || JSON.stringify(data).slice(0, 80);
      case 'face:recognition':
        return data.name ? `Recognized: ${data.name}` : 'No known faces';

      // Memory retrieval
      case 'memory:retrieve':
        return `Tier ${data.tier}, ${data.notesUsed} note(s)`;
      case 'memory:upsert':
        return `${data.category}: "${(data.note || '').slice(0, 40)}"`;

      // Pantry
      case 'pantry:decrement':
        return `${data.item} -${data.qty}${data.unit}, ${data.remaining} left`;
      case 'pantry:add':
        return `Added ${data.item} (${data.confidence} confidence)`;

      default:
        const str = JSON.stringify(data);
        return str.length > 80 ? str.slice(0, 80) + '...' : str;
    }
  } catch {
    return 'Result logged';
  }
}
