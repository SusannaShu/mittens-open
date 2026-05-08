/**
 * Filter Orders -- deterministic email scoring.
 * Code only, no AI. Scores emails for order/receipt relevance.
 */

import type { EmailCandidate } from '../types';
import { matchRetailer, ORDER_SUBJECT_KEYWORDS, ORDER_BODY_PATTERNS } from './retailers';

const SCORE_THRESHOLD = 0.3;

interface ScoredCandidate extends EmailCandidate {
  score: number;
  retailer?: string;
}

/**
 * Score and filter emails for order confirmation relevance.
 * Returns only candidates above threshold, sorted by score descending.
 */
export function filterOrderEmails(candidates: EmailCandidate[]): ScoredCandidate[] {
  const scored: ScoredCandidate[] = candidates.map(c => ({
    ...c,
    score: scoreEmail(c),
    retailer: matchRetailer(c.from) || undefined,
  }));

  return scored
    .filter(c => c.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

/**
 * Score a single email for order relevance (0-1).
 */
function scoreEmail(candidate: EmailCandidate): number {
  let score = 0;
  const maxScore = 5; // normalize to 0-1

  const subjectLower = candidate.subject.toLowerCase();
  const snippetLower = candidate.snippet.toLowerCase();
  const bodyLower = (candidate.cleanedBody || '').toLowerCase();
  const searchText = `${subjectLower} ${snippetLower} ${bodyLower}`;

  // 1. Known retailer sender (+2)
  if (matchRetailer(candidate.from)) {
    score += 2;
  }

  // 2. Subject contains order keywords (+1.5)
  const subjectMatch = ORDER_SUBJECT_KEYWORDS.some(kw => subjectLower.includes(kw));
  if (subjectMatch) {
    score += 1.5;
  }

  // 3. Body contains price patterns (+0.5)
  if (ORDER_BODY_PATTERNS.price.test(searchText)) {
    score += 0.5;
  }
  // Reset regex lastIndex
  ORDER_BODY_PATTERNS.price.lastIndex = 0;

  // 4. Body contains order number (+0.5)
  if (ORDER_BODY_PATTERNS.orderNumber.test(searchText)) {
    score += 0.5;
  }
  ORDER_BODY_PATTERNS.orderNumber.lastIndex = 0;

  // 5. Body contains tracking info (+0.5 bonus)
  if (ORDER_BODY_PATTERNS.tracking.test(searchText)) {
    score += 0.5;
  }
  ORDER_BODY_PATTERNS.tracking.lastIndex = 0;

  return Math.min(score / maxScore, 1);
}
