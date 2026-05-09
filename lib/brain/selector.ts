/**
 * brain/selector.ts -- AI model selection logic.
 * Stub for open-source version (always selects local model).
 */

export function selectModel(_task: string): string {
  return 'gemma-local';
}

export function getAvailableModels(): string[] {
  return ['gemma-local'];
}
