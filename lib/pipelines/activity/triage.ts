import { PipelineInput } from '../runner';

export type ActivityPhase = 'detect' | 'environment' | 'social' | 'objects' | 'lifeDesign';

/**
 * Micro-triage for the Activity pipeline.
 * Inspects available context to determine which phases are necessary.
 * 
 * TWO-LEVEL GATING:
 *   1. Top-level triage provides `inferrablePhases` — which dimensions have
 *      actual evidence in the input (e.g., a cactus photo → only detect + environment)
 *   2. Manual data check — if user already filled a field, skip that phase
 *
 * A phase runs ONLY if:
 *   a) Not manually filled by user, AND
 *   b) Either: no inferrablePhases hint (legacy/fallback), OR phase is in the hint list
 *
 * This prevents wasteful API calls (and 429 errors) for phases that
 * have nothing to infer from.
 */
export function getActivityPhases(input: PipelineInput, inferrablePhases?: string[]): ActivityPhase[] {
  const phases: ActivityPhase[] = [];
  const manual = input.manualData || {};

  // Helper: should this phase run?
  const shouldRun = (phase: ActivityPhase, manualOverride: boolean): boolean => {
    if (manualOverride) return false; // User already filled this field
    if (!inferrablePhases || inferrablePhases.length === 0) {
      // No hints from triage — fall back to context-based gating (legacy behavior)
      return true;
    }
    return inferrablePhases.includes(phase);
  };

  const hasContext = !!(input.text || (input.photos && input.photos.length > 0));

  // Phase 1: Detect — always run unless user manually selected a type
  if (shouldRun('detect', !!manual.activityType)) {
    phases.push('detect');
  }

  // Phase 2: Environment
  // Skip if user manually specified AEIOU 'E' (Environment) or outdoors/nature toggles
  const hasManualEnv = manual.aeiou?.environment || manual.outdoors !== undefined || manual.isNature !== undefined;
  if (shouldRun('environment', hasManualEnv) && hasContext) {
    phases.push('environment');
  }

  // Phase 3: Social
  // Skip if user manually specified AEIOU 'I' (Interactions)
  // Smart skip: if triage says no social evidence, this won't be in inferrablePhases
  const hasManualSocial = !!manual.aeiou?.interactions;
  if (shouldRun('social', hasManualSocial) && hasContext) {
    phases.push('social');
  }

  // Phase 4: Objects
  // Skip if user manually specified AEIOU 'O' (Objects)
  const hasManualObjects = !!manual.aeiou?.objects;
  if (shouldRun('objects', hasManualObjects) && hasContext) {
    phases.push('objects');
  }

  // Phase 5: LifeDesign
  // Generates life category weights + AEIOU 'U' (Users)
  // Even if not using AI (empty context), we need this phase to pull predetermined weights
  // Skip only if user manually set lifeCategories already
  if (!manual.lifeCategories) {
    // For lifeDesign without context, we can still use ActivityType defaults (deterministic)
    // So this phase runs even if not in inferrablePhases, but won't call the brain
    phases.push('lifeDesign');
  }

  return phases;
}
