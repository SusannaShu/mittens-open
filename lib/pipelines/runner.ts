import { TemporalResult } from './types';
import { PipelineLogger, summarizeResult } from './logger';

export interface PipelineInput {
  source: 'chat' | 'manual' | 'pendant';
  text?: string;
  photos?: string[];
  manualData?: any; // pre-filled fields for manual entry
  temporal?: TemporalResult;
}

export interface PipelineState {
  status: 'idle' | 'running' | 'complete' | 'error';
  currentPhase?: string;
  result?: any;
  error?: string;
}

export type PipelineUpdateCallback = (domain: string, state: PipelineState) => void;

/**
 * The unified pipeline runner orchestrator.
 */
export class PipelineRunner {
  private updateCb?: PipelineUpdateCallback;
  public logger: PipelineLogger;

  constructor(onUpdate?: PipelineUpdateCallback, brainId?: string) {
    this.updateCb = onUpdate;
    this.logger = new PipelineLogger(brainId);
  }

  private emit(domain: string, state: PipelineState) {
    const phase = state.currentPhase ? `:${state.currentPhase}` : '';
    console.log(`[Pipeline] ${domain}${phase} -> ${state.status}${state.error ? ` (${state.error})` : ''}`);
    if (this.updateCb) {
      this.updateCb(domain, state);
    }
  }

  /**
   * Main entry point to run the activity pipeline.
   * Branches on brain type: cloud → single combined call, local → sequential phases.
   */
  async runActivityPipeline(input: PipelineInput, inferrablePhases?: string[]): Promise<any> {
    this.emit('activity', { status: 'running', currentPhase: 'triage' });

    try {
      const { getActivityPhases } = await import('./activity/triage');
      const { getBrain } = await import('../brain/selector');
      const brain = await getBrain();
      
      // 2. Triage inspects available context → returns runnable phase list
      const phasesToRun = getActivityPhases(input, inferrablePhases);
      const triageIdx = this.logger.startPhase('activity', 'triage');
      this.logger.completePhase(triageIdx, `Phases: ${phasesToRun.join(', ')}`);

      if (phasesToRun.length === 0) {
        this.emit('activity', { status: 'complete', result: input.manualData || {} });
        return input.manualData || {};
      }

      // CLOUD PATH: combine all phases into one API call
      if (!brain.isLocal && phasesToRun.length > 1) {
        return await this.runActivityCloud(input, phasesToRun);
      }

      // LOCAL PATH: sequential per-phase execution
      return await this.runActivitySequential(input, phasesToRun);
      
    } catch (error: any) {
      this.emit('activity', { status: 'error', error: error.message });
      throw error;
    }
  }

  private async runActivityCloud(input: PipelineInput, phasesToRun: string[]): Promise<any> {
    // Emit all phases as 'running' simultaneously
    for (const phase of phasesToRun) {
      this.emit('activity', { status: 'running', currentPhase: phase });
    }
    const batchIdx = this.logger.startPhase('activity', `cloud-batch(${phasesToRun.join('+')})`);

    try {
      const { runActivityPhasesCloud } = await import('./activity/cloudBatch');
      const context = await runActivityPhasesCloud(input, phasesToRun as any);
      this.logger.completePhase(batchIdx, `${phasesToRun.length} phases in 1 call`);
      this.emit('activity', { status: 'complete', result: context });
      return context;
    } catch (err: any) {
      this.logger.failPhase(batchIdx, err.message);
      throw err;
    }
  }

  private async runActivitySequential(input: PipelineInput, phasesToRun: string[]): Promise<any> {
    let context: any = { ...input.manualData };

    for (const phase of phasesToRun) {
      this.emit('activity', { status: 'running', currentPhase: phase });
      const phaseIdx = this.logger.startPhase('activity', phase);
      
      try {
        switch (phase) {
          case 'detect':
            const { detectActivity } = await import('./activity/detect');
            const detectResult = await detectActivity(input);
            context = { ...context, ...detectResult };
            this.logger.completePhase(phaseIdx, summarizeResult('activity', 'detect', detectResult));
            break;
            
          case 'environment':
            const { detectEnvironment } = await import('./activity/environment');
            const envResult = await detectEnvironment(input, context);
            context = { ...context, ...envResult };
            this.logger.completePhase(phaseIdx, summarizeResult('activity', 'environment', envResult));
            break;
            
          case 'social':
            const { detectSocial } = await import('./activity/social');
            const socialResult = await detectSocial(input, context);
            context = { ...context, ...socialResult };
            this.logger.completePhase(phaseIdx, summarizeResult('activity', 'social', socialResult));
            break;
            
          case 'objects':
            const { detectObjects } = await import('./activity/objects');
            const objectsResult = await detectObjects(input, context);
            context = { ...context, ...objectsResult };
            this.logger.completePhase(phaseIdx, summarizeResult('activity', 'objects', objectsResult));
            break;
            
          case 'lifeDesign':
            const { inferLifeDesign } = await import('./activity/lifeDesign');
            const ldResult = await inferLifeDesign(input, context);
            context = { ...context, ...ldResult };
            this.logger.completePhase(phaseIdx, summarizeResult('activity', 'lifeDesign', ldResult));
            break;

          case 'pantryDelta':
            const { extractPantryDeltas } = await import('./food/pantryDelta');
            const deltaResult = await extractPantryDeltas(input);
            context = { ...context, ...deltaResult };
            this.logger.completePhase(phaseIdx, summarizeResult('activity', 'pantryDelta', deltaResult));
            break;

          default:
            this.logger.skipPhase('activity', phase, 'Unknown phase');
        }
      } catch (phaseError: any) {
        this.logger.failPhase(phaseIdx, phaseError.message || 'Phase failed');
        throw phaseError;
      }
    }

    this.emit('activity', { status: 'complete', result: context });
    return context;
  }




  async runFoodPipeline(input: PipelineInput, phasesToRun?: string[]): Promise<any> {
    let result = {};
    const phases = phasesToRun || ['eatingContext', 'pantryDelta']; // Default to all if not specified

    if (phases.includes('eatingContext')) {
      this.emit('food', { status: 'running', currentPhase: 'eatingContext' });
      const phaseIdx = this.logger.startPhase('food', 'eatingContext');
      try {
        const { inferEatingContext } = await import('./food/eatingContext');
        const phaseResult = await inferEatingContext(input);
        this.logger.completePhase(phaseIdx, summarizeResult('food', 'eatingContext', phaseResult));
        this.emit('food', { status: 'complete', result: phaseResult });
        result = { ...result, ...phaseResult };
      } catch (e: any) {
        this.logger.failPhase(phaseIdx, e.message);
        this.emit('food', { status: 'error', error: e.message });
        throw e;
      }
    } else {
      this.logger.skipPhase('food', 'eatingContext', 'No triage evidence');
    }

    if (phases.includes('pantryDelta')) {
      this.emit('food', { status: 'running', currentPhase: 'pantryDelta' });
      const phaseIdx = this.logger.startPhase('food', 'pantryDelta');
      try {
        const { extractPantryDeltas } = await import('./food/pantryDelta');
        const phaseResult = await extractPantryDeltas(input);
        this.logger.completePhase(phaseIdx, summarizeResult('food', 'pantryDelta', phaseResult));
        this.emit('food', { status: 'complete', result: phaseResult });
        result = { ...result, ...phaseResult };
      } catch (e: any) {
        this.logger.failPhase(phaseIdx, e.message);
        this.emit('food', { status: 'error', error: e.message });
        throw e;
      }
    } else {
      this.logger.skipPhase('food', 'pantryDelta', 'No triage evidence');
    }
    
    // Fallback emit if no phases were run (or multiple phases run successfully)
    if (Object.keys(result).length > 0 || phases.length === 0) {
      this.emit('food', { status: 'complete', result });
    }
    return result;
  }

  async runSleepPipeline(input: PipelineInput): Promise<any> {
    this.emit('sleep', { status: 'running', currentPhase: 'detect' });
    const phaseIdx = this.logger.startPhase('sleep', 'detect');
    try {
      const { detectSleep } = await import('./sleep/detect');
      const result = await detectSleep(input);
      this.logger.completePhase(phaseIdx, summarizeResult('sleep', 'detect', result));
      this.emit('sleep', { status: 'complete', result });
      return result;
    } catch (e: any) {
      this.logger.failPhase(phaseIdx, e.message);
      this.emit('sleep', { status: 'error', error: e.message });
      throw e;
    }
  }

  async runChatPipeline(input: PipelineInput): Promise<any> {
    // Phase 1: Classify
    this.emit('chat', { status: 'running', currentPhase: 'classify' });
    const classifyIdx = this.logger.startPhase('chat', 'classify');
    let classRes: any;
    try {
      const { classifyChat } = await import('./chat/classify');
      classRes = await classifyChat(input);
      this.logger.completePhase(classifyIdx, summarizeResult('chat', 'classify', classRes));
    } catch (e: any) {
      this.logger.failPhase(classifyIdx, e.message);
      throw e;
    }

    // Phase 2: Respond -- use directReply from classify if available
    this.emit('chat', { status: 'running', currentPhase: 'respond' });
    const respondIdx = this.logger.startPhase('chat', 'respond');
    let respRes: any;
    try {
      if (classRes?.directReply) {
        respRes = { reply: classRes.directReply };
        this.logger.completePhase(respondIdx, `"${classRes.directReply.slice(0, 60)}"`);
      } else {
        const { generateChatResponse } = await import('./chat/respond');
        respRes = await generateChatResponse(input.text || '', '');
        this.logger.completePhase(respondIdx, summarizeResult('chat', 'respond', respRes));
      }
    } catch (e: any) {
      this.logger.failPhase(respondIdx, e.message);
      throw e;
    }

    // Return reply immediately. Side effects are returned as an async thunk
    // so the caller can fire-and-forget them while showing the reply.
    const finalResult = {
      ...classRes,
      ...respRes,
      /** Async side effects runner. Call this after showing the reply. */
      runSideEffects: async (): Promise<any> => {
        const sideEffectsIdx = this.logger.startPhase('chat', 'sideEffects');
        try {
          const { runSideEffects } = await import('./chat/sideEffects');
          const effects = await runSideEffects(input, classRes);
          this.logger.completePhase(sideEffectsIdx, summarizeResult('chat', 'sideEffects', effects));
          return effects;
        } catch (e: any) {
          this.logger.failPhase(sideEffectsIdx, e.message);
          return null;
        }
      },
    };
    this.emit('chat', { status: 'complete', result: finalResult });
    return finalResult;
  }

  async runPantryPipeline(
    input: PipelineInput,
    onProgress?: (items: any[], status: string) => void,
  ): Promise<any> {
    // Phase 1: Identify
    this.emit('pantry', { status: 'running', currentPhase: 'identify' });
    const identifyIdx = this.logger.startPhase('pantry', 'identify');
    let identRes: any;
    try {
      const { identifyPantryItem } = await import('./pantry/identify');
      identRes = await identifyPantryItem(input);
      this.logger.completePhase(identifyIdx, summarizeResult('pantry', 'identify', identRes));
    } catch (e: any) {
      this.logger.failPhase(identifyIdx, e.message);
      this.emit('pantry', { status: 'error', error: e.message });
      throw e;
    }

    // Surface identified items immediately
    if (onProgress && identRes.items?.length > 0) {
      const initialItems = identRes.items.map((item: any) => ({
        name: item.name || 'Unknown',
        quantity: item.quantity || '',
        confidence: item.confidence ?? 0.8,
        status: 'complete',
        freshness: item.freshness,
        storageLocation: item.storageLocation,
        checkBy: item.checkBy,
      }));
      onProgress(initialItems, 'complete');
      this.emit('pantry', { status: 'complete', result: initialItems });
      return initialItems;
    }

    this.emit('pantry', { status: 'complete', result: [] });
    return [];
  }

  async runEmailPipeline(input: PipelineInput): Promise<any> {
    // Phase 1: Plan -- brain decides what to do
    this.emit('email', { status: 'running', currentPhase: 'plan' });
    const planIdx = this.logger.startPhase('email', 'plan');
    let plan: any;
    try {
      const { planEmailAction } = await import('./email/plan');
      plan = await planEmailAction(input);
      this.logger.completePhase(planIdx, `Action: ${plan.actionType}`);
    } catch (e: any) {
      this.logger.failPhase(planIdx, e.message);
      this.emit('email', { status: 'error', error: e.message });
      throw e;
    }

    // Phase 2+: Execute based on plan
    try {
      switch (plan.actionType) {
        case 'search_orders':
          return await this.executeSearchOrders(plan);
        case 'search_read':
          return await this.executeSearchRead(plan);
        case 'search_read_act':
          return await this.executeSearchReadAct(plan);
        case 'compose_send':
          return await this.executeComposeSend(plan);
        default:
          return await this.executeSearchRead(plan);
      }
    } catch (e: any) {
      this.emit('email', { status: 'error', error: e.message });
      throw e;
    }
  }

  private async executeSearchOrders(plan: any): Promise<any> {
    // Search
    this.emit('email', { status: 'running', currentPhase: 'search' });
    const searchIdx = this.logger.startPhase('email', 'search');
    const { searchEmails } = await import('./email/search');
    const candidates = await searchEmails(plan);
    this.logger.completePhase(searchIdx, `${candidates.length} emails found`);

    if (candidates.length === 0) {
      this.emit('email', { status: 'complete', result: { plan, orderItems: [], stats: { searched: 0, read: 0 } } });
      return { plan, orderItems: [], stats: { searched: 0, read: 0 } };
    }

    // Filter
    this.emit('email', { status: 'running', currentPhase: 'filter' });
    const filterIdx = this.logger.startPhase('email', 'filter');
    const { filterOrderEmails } = await import('./email/filterOrders');
    const filtered = filterOrderEmails(candidates);
    this.logger.completePhase(filterIdx, `${filtered.length} passed filter`);

    // Read filtered emails
    this.emit('email', { status: 'running', currentPhase: 'read' });
    const readIdx = this.logger.startPhase('email', 'read');
    const { readEmails } = await import('./email/read');
    const readResults = await readEmails(filtered, 5);
    this.logger.completePhase(readIdx, `${readResults.length} emails read`);

    // Parse orders
    this.emit('email', { status: 'running', currentPhase: 'parse' });
    const parseIdx = this.logger.startPhase('email', 'parse');
    const { parseOrderEmails } = await import('./email/parseOrders');
    const orderItems = await parseOrderEmails(readResults);
    this.logger.completePhase(parseIdx, `${orderItems.length} items extracted`);

    const result = { plan, orderItems, stats: { searched: candidates.length, read: readResults.length } };
    this.emit('email', { status: 'complete', result });
    return result;
  }

  private async executeSearchRead(plan: any): Promise<any> {
    // Search
    this.emit('email', { status: 'running', currentPhase: 'search' });
    const searchIdx = this.logger.startPhase('email', 'search');
    const { searchEmails } = await import('./email/search');
    const candidates = await searchEmails(plan);
    this.logger.completePhase(searchIdx, `${candidates.length} emails found`);

    // Read
    this.emit('email', { status: 'running', currentPhase: 'read' });
    const readIdx = this.logger.startPhase('email', 'read');
    const { readEmails } = await import('./email/read');
    const readResults = await readEmails(candidates, 3);
    this.logger.completePhase(readIdx, `${readResults.length} emails read`);

    // Answer
    this.emit('email', { status: 'running', currentPhase: 'answer' });
    const answerIdx = this.logger.startPhase('email', 'answer');
    const { answerFromEmails } = await import('./email/answer');
    const answer = await answerFromEmails(readResults, plan.question || '');
    this.logger.completePhase(answerIdx, 'Answer generated');

    const result = { plan, answer, stats: { searched: candidates.length, read: readResults.length } };
    this.emit('email', { status: 'complete', result });
    return result;
  }

  private async executeSearchReadAct(plan: any): Promise<any> {
    // Search + Read
    this.emit('email', { status: 'running', currentPhase: 'search' });
    const searchIdx = this.logger.startPhase('email', 'search');
    const { searchEmails } = await import('./email/search');
    const candidates = await searchEmails(plan);
    this.logger.completePhase(searchIdx, `${candidates.length} emails found`);

    this.emit('email', { status: 'running', currentPhase: 'read' });
    const readIdx = this.logger.startPhase('email', 'read');
    const { readEmails } = await import('./email/read');
    const readResults = await readEmails(candidates, 3);
    this.logger.completePhase(readIdx, `${readResults.length} emails read`);

    // Extract based on downstream action
    if (plan.downstreamAction === 'add_to_calendar') {
      this.emit('email', { status: 'running', currentPhase: 'extractEvent' });
      const eventIdx = this.logger.startPhase('email', 'extractEvent');
      const { extractEvent } = await import('./email/extractEvent');
      const event = await extractEvent(readResults);
      this.logger.completePhase(eventIdx, event ? `Event: ${event.title}` : 'No event found');

      const result = { plan, extractedEvent: event, stats: { searched: candidates.length, read: readResults.length } };
      this.emit('email', { status: 'complete', result });
      return result;
    }

    // Default: answer + note the downstream action
    const { answerFromEmails } = await import('./email/answer');
    const answer = await answerFromEmails(readResults, plan.question || '');
    const result = { plan, answer, stats: { searched: candidates.length, read: readResults.length } };
    this.emit('email', { status: 'complete', result });
    return result;
  }

  private async executeComposeSend(plan: any): Promise<any> {
    // Resolve recipient
    this.emit('email', { status: 'running', currentPhase: 'resolve' });
    const resolveIdx = this.logger.startPhase('email', 'resolve');

    let recipientEmail = plan.recipient?.emailHint || '';
    if (!recipientEmail && plan.recipient?.name) {
      const { resolveContact } = await import('./email/resolveContact');
      const contact = await resolveContact(plan.recipient.name);
      if (contact) {
        recipientEmail = contact.email;
        plan.recipient.emailHint = contact.email;
      }
    }
    this.logger.completePhase(resolveIdx, recipientEmail ? `Resolved: ${recipientEmail}` : 'No email found');

    // Compose draft
    this.emit('email', { status: 'running', currentPhase: 'compose' });
    const composeIdx = this.logger.startPhase('email', 'compose');
    const { composeEmail } = await import('./email/compose');
    const draft = await composeEmail(plan);
    draft.to = recipientEmail || draft.to;
    this.logger.completePhase(composeIdx, `Draft: "${draft.subject}"`);

    // Return draft for user review -- NEVER auto-send
    const result = { plan, draft, stats: { searched: 0, read: 0 } };
    this.emit('email', { status: 'complete', result });
    return result;
  }

  async runWatchPipeline(input: PipelineInput): Promise<any> {
    // Phase 1: Plan -- brain decides what to fetch and how to filter
    this.emit('watch', { status: 'running', currentPhase: 'plan' });
    const planIdx = this.logger.startPhase('watch', 'plan');
    let plan: any;
    try {
      const { planWatchAction } = await import('./watch/plan');
      plan = await planWatchAction(input);
      this.logger.completePhase(planIdx, summarizeResult('watch', 'plan', plan));
    } catch (e: any) {
      this.logger.failPhase(planIdx, e.message);
      this.emit('watch', { status: 'error', error: e.message });
      throw e;
    }

    if (plan.sources.length === 0) {
      const noSourceResult = {
        plan,
        items: [],
        stats: { fetched: 0, kept: 0, extracted: 0 },
        reply: "I couldn't figure out which site to check. Could you be more specific?",
      };
      this.emit('watch', { status: 'complete', result: noSourceResult });
      return noSourceResult;
    }

    // Phase 2: Fetch -- code only, returns pre-split items
    this.emit('watch', { status: 'running', currentPhase: 'fetch' });
    const fetchIdx = this.logger.startPhase('watch', 'fetch');
    let fetched: any[];
    try {
      const { fetchWatchContent } = await import('./watch/fetch');
      fetched = await fetchWatchContent(plan);
      this.logger.completePhase(fetchIdx, summarizeResult('watch', 'fetch', fetched));
    } catch (e: any) {
      this.logger.failPhase(fetchIdx, e.message);
      this.emit('watch', { status: 'error', error: e.message });
      throw e;
    }

    if (fetched.length === 0) {
      const emptyResult = {
        plan,
        items: [],
        stats: { fetched: 0, kept: 0, extracted: 0 },
        reply: `I couldn't reach ${plan.sources[0]?.url || 'the site'} right now. Try again?`,
      };
      this.emit('watch', { status: 'complete', result: emptyResult });
      return emptyResult;
    }

    // Phase 3: Filter -- brain keeps/skips items
    this.emit('watch', { status: 'running', currentPhase: 'filter' });
    const filterIdx = this.logger.startPhase('watch', 'filter');
    let filterResult: any;
    try {
      const { filterWatchItems } = await import('./watch/filter');
      filterResult = await filterWatchItems(fetched, plan.filter, plan.needsVision);
      this.logger.completePhase(filterIdx, summarizeResult('watch', 'filter', filterResult));
    } catch (e: any) {
      this.logger.failPhase(filterIdx, e.message);
      // Fail open: keep all items if filter fails
      filterResult = { kept: fetched, skipped: [] };
    }

    if (filterResult.kept.length === 0) {
      const noMatchResult = {
        plan,
        items: [],
        stats: { fetched: fetched.length, kept: 0, extracted: 0 },
        reply: `I checked ${plan.sources[0]?.url || 'the site'} -- found ${fetched.length} items but none matched "${plan.filter}".`,
      };
      this.emit('watch', { status: 'complete', result: noMatchResult });
      return noMatchResult;
    }

    // Phase 4: Extract -- brain pulls structured details (optional)
    this.emit('watch', { status: 'running', currentPhase: 'extract' });
    const extractIdx = this.logger.startPhase('watch', 'extract');
    let extracted: any[];
    try {
      const { extractWatchDetails } = await import('./watch/extract');
      extracted = await extractWatchDetails(filterResult.kept, plan.needsVision);
      this.logger.completePhase(extractIdx, summarizeResult('watch', 'extract', extracted));
    } catch (e: any) {
      this.logger.failPhase(extractIdx, e.message);
      // Fail open: use unextracted items
      extracted = filterResult.kept;
    }

    // Save to dedup cache
    try {
      const { saveWatchItems } = await import('./watch/items');
      saveWatchItems(
        extracted.map((item: any) => ({
          sourceId: plan.savedSourceId || undefined,
          itemHash: item.id,
          title: item.title,
          url: item.url,
          summary: item.body,
          imageUrl: item.imageUrl,
          author: item.author,
          publishedAt: item.publishedAt,
          extractedData: item.extracted,
          filterReason: item.filterReason,
        })),
      );
    } catch (e: any) {
      // Non-fatal: dedup cache save failure shouldn't break the pipeline
      console.error('[Watch] Failed to save items to cache:', e?.message);
    }

    const result = {
      plan,
      items: extracted,
      stats: {
        fetched: fetched.length,
        kept: filterResult.kept.length,
        extracted: extracted.length,
      },
    };

    this.emit('watch', { status: 'complete', result });
    return result;
  }
}
