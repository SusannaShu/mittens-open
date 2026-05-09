/**
 * brain/types.ts -- Type definitions for the AI brain subsystem.
 */

export interface BrainMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface BrainConfig {
  model: string;
  provider: string;
  temperature?: number;
  maxTokens?: number;
}

export interface BrainResponse {
  text: string;
  provider: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}
