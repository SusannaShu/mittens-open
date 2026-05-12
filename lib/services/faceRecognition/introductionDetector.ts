/**
 * faceRecognition/introductionDetector.ts
 *
 * Parses voice transcripts to detect person introductions.
 *
 * Recognized patterns:
 *   "Mittens, this is Caden"
 *   "this is my friend Caden"
 *   "meet Caden"
 *   "remember Caden"
 *   "his name is Caden"
 *   "her name is Caden"
 *   "that's Caden"
 */

/** Result of parsing a transcript for an introduction */
export interface IntroductionParse {
  /** The detected name */
  name: string;
  /** The original matched pattern */
  pattern: string;
}

/**
 * Introduction phrase patterns.
 * Each regex should have a named capture group `name` for the person's name.
 */
const INTRO_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  {
    regex: /(?:mittens[,.]?\s+)?this\s+is\s+(?:my\s+\w+\s+)?(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    label: 'this is [name]',
  },
  {
    regex: /(?:mittens[,.]?\s+)?meet\s+(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    label: 'meet [name]',
  },
  {
    regex: /(?:mittens[,.]?\s+)?remember\s+(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    label: 'remember [name]',
  },
  {
    regex: /(?:his|her|their)\s+name\s+is\s+(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    label: '[pronoun] name is [name]',
  },
  {
    regex: /that(?:'s| is)\s+(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    label: "that's [name]",
  },
];

/**
 * Parse a transcript for person introduction patterns.
 * Returns the detected name and pattern, or null if no introduction found.
 */
export function parseIntroduction(transcript: string): IntroductionParse | null {
  const trimmed = transcript.trim();
  if (!trimmed) return null;

  for (const { regex, label } of INTRO_PATTERNS) {
    const match = trimmed.match(regex);
    if (match?.groups?.name) {
      const name = match.groups.name.trim();
      // Skip common non-name words that might match
      if (isCommonWord(name)) continue;
      return { name, pattern: label };
    }
  }

  return null;
}

/** Filter out words that are obviously not names */
function isCommonWord(word: string): boolean {
  const lower = word.toLowerCase();
  const skipWords = new Set([
    'the', 'a', 'an', 'my', 'your', 'his', 'her', 'their',
    'what', 'who', 'where', 'when', 'how', 'why',
    'yes', 'no', 'ok', 'okay',
    'food', 'thing', 'stuff', 'person', 'someone',
  ]);
  return skipWords.has(lower);
}
