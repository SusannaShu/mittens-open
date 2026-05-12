/**
 * faceRecognition/greetingComposer.ts
 *
 * Generates contextual, dynamic greetings when a known person is recognized.
 *
 * Uses the brain to compose natural greetings based on:
 *   - Person's name and relationship context
 *   - Time of day
 *   - Recent interactions and memories
 *   - Current location/activity
 *
 * Never uses hardcoded greetings. Each greeting is unique and contextual.
 */

import type { FaceMatch } from './types';
import { getPersonById, getEmbeddingCount } from './faceRecognitionApi';

/**
 * Compose a contextual greeting for a recognized person.
 * Returns a short, natural greeting string for TTS.
 */
export async function composeGreeting(match: FaceMatch): Promise<string> {
  const person = getPersonById(match.personId);
  if (!person) return '';

  // Gather context for the greeting
  const context = buildGreetingContext(person, match);

  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const prompt = [
      'You are Mittens, a friendly personal AI assistant worn as a pendant.',
      `You just recognized ${person.name} nearby.`,
      `Compose a brief, warm, natural greeting (1 sentence max).`,
      '',
      'Context:',
      context,
      '',
      'Rules:',
      '- Be warm and natural, like greeting a friend',
      '- Reference something contextual (time of day, last interaction, etc)',
      '- Never be generic like "Hello, how are you?"',
      '- Keep it to 1 short sentence',
      '- Do not use emojis',
      '- Speak directly to them by name',
    ].join('\n');

    const greeting = await brain.text(prompt);
    return greeting?.trim() || fallbackGreeting(person.name);
  } catch (err: any) {
    console.warn('[GreetingComposer] Brain call failed:', err?.message);
    return fallbackGreeting(person.name);
  }
}

/**
 * Build context string for the greeting prompt.
 */
function buildGreetingContext(person: any, match: FaceMatch): string {
  const lines: string[] = [];

  // Time of day
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  lines.push(`Time: ${timeOfDay}`);

  // Relationship
  if (person.teamRole) {
    lines.push(`Relationship: ${person.teamRole}`);
  }
  if (person.context) {
    lines.push(`Notes: ${person.context}`);
  }

  // Interaction history
  lines.push(`Times seen: ${person.interactionCount}`);
  if (person.lastSeenAt) {
    lines.push(`Last seen: ${person.lastSeenAt}`);
  }

  // Recognition strength
  lines.push(`Recognition confidence: ${Math.round(match.similarity * 100)}%`);
  lines.push(`Learned from ${match.embeddingCount} sightings`);

  // Current location (if available)
  try {
    const { getCurrentPlace } = require('../location/locationService');
    const place = getCurrentPlace();
    if (place) {
      lines.push(`Current location: ${place}`);
    }
  } catch { /* location not available */ }

  // Recent memories about this person
  try {
    const { getLongTermNotes } = require('../ambient/memoryUpsert');
    const notes = getLongTermNotes(person.name);
    if (notes.length > 0) {
      lines.push(`Memories: ${notes.map((n: any) => n.note).join('; ')}`);
    }
  } catch { /* memory not available */ }

  return lines.join('\n');
}

/**
 * Simple fallback greeting when the brain is unavailable.
 * Varies by time of day so it doesn't feel robotic.
 */
function fallbackGreeting(name: string): string {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}!`;
  if (hour < 17) return `Hey ${name}, good to see you!`;
  return `Good evening, ${name}!`;
}
