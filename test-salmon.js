const { COMMON_FOODS } = require('./lib/data/commonFoods');

function normalizeName(name) {
  let n = name.toLowerCase().trim();
  n = n.replace(/\([^)]*\)/g, '').trim();
  n = n.replace(/^(fresh|raw|organic|dried|frozen|canned|cooked|roasted|grilled|steamed|baked|fried)\s+/g, '');
  n = n.replace(/\s+(sliced|diced|chopped|minced|whole|pieces|chunks)$/g, '');
  return n;
}

function stemToken(t) {
  if (t.length <= 3) return t;
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('oes') && t.length > 5) return t.slice(0, -2);
  if (t.endsWith('ches') || t.endsWith('shes') || t.endsWith('sses') || t.endsWith('xes') || t.endsWith('zes'))
    return t.slice(0, -2);
  if (t.endsWith('ves') && t.length > 5) return t.slice(0, -1);
  if (t.endsWith('es') && t.length > 4) return t.slice(0, -1);
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1);
  return t;
}

const STOP_WORDS = new Set(['likely', 'other', 'speck', 'the', 'and', 'with', 'for', 'from']);
const COLOR_WORDS = new Set(['red', 'orange', 'green', 'yellow', 'white', 'brown', 'black', 'dark', 'light', 'golden', 'purple']);

function tokenMatch(qt, at) {
  if (qt === at) return 1.0;
  const qStem = stemToken(qt);
  const aStem = stemToken(at);
  if (qStem === aStem) return 1.0;
  if (qt.length > 3 && at.length > 3) {
    if (at.startsWith(qt) || qt.startsWith(at)) return 0.8;
    if (aStem.startsWith(qStem) || qStem.startsWith(aStem)) return 0.8;
  }
  return 0;
}

function matchScore(query, entry) {
  const q = normalizeName(query);
  const qStemmed = stemToken(q);
  const qTokens = q.split(/[\s/,]+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));
  if (qTokens.length === 0) return 0;
  const qSubstantive = qTokens.filter(t => !COLOR_WORDS.has(t));
  const qColors = qTokens.filter(t => COLOR_WORDS.has(t));
  let bestScore = 0;

  for (const alias of entry.aliases) {
    const a = alias.toLowerCase();
    
    // We want to debug this exact loop for fdcId 173723
    let scoreInfo = { alias: alias, steps: [] };
    
    if (a === q || a === qStemmed) {
      if (entry.fdcId === 173723) console.log(`[173723] Exact match: a="${a}", q="${q}" -> returns 1.0`);
      return 1.0;
    }

    const aWords = a.split(/[\s,]+/).filter(t => t.length > 1);
    if (aWords.length === 1 && qTokens.length === 1) {
      if (stemToken(aWords[0]) === stemToken(qTokens[0])) {
        if (entry.fdcId === 173723) console.log(`[173723] Stem single match: aWords="${aWords[0]}" -> returns 0.98`);
        return 0.98;
      }
    }

    if (a.startsWith(q + ',') || a.startsWith(q + ' ')) {
      if (entry.fdcId === 173723) console.log(`[173723] StartsWith + separator match: a="${a}", q="${q}" -> score = 0.95`);
      if (0.95 > bestScore) bestScore = 0.95;
      continue;
    }
    if (a.startsWith(qStemmed + ',') || a.startsWith(qStemmed + ' ')) {
      if (entry.fdcId === 173723) console.log(`[173723] StartsWithStemmed + separator match: a="${a}", qStemmed="${qStemmed}" -> score = 0.95`);
      if (0.95 > bestScore) bestScore = 0.95;
      continue;
    }
    {
      const firstAToken = aWords[0];
      if (firstAToken && qTokens.length === 1 && stemToken(firstAToken) === stemToken(qTokens[0])) {
        const specificity = Math.max(0.85, 0.95 - (aWords.length - 1) * 0.03);
        if (entry.fdcId === 173723) console.log(`[173723] Stem primary match: a="${a}", firstAToken="${firstAToken}" -> specificity = ${specificity}`);
        if (specificity > bestScore) bestScore = specificity;
        continue;
      }
    }

    if (a.startsWith(q)) {
      if (entry.fdcId === 173723) console.log(`[173723] StartsWith query: a="${a}", q="${q}" -> score = 0.9`);
      if (0.9 > bestScore) bestScore = 0.9;
      continue;
    }

    const aTokens = aWords;
    let overlapCount = 0;
    let unmatchedQueryTokens = 0;
    qSubstantive.forEach((qt) => {
      let matched = false;
      for (const at of aTokens) {
        const m = tokenMatch(qt, at);
        if (m > 0) { overlapCount += m; matched = true; break; }
      }
      if (!matched) unmatchedQueryTokens++;
    });
    qColors.forEach(qt => {
      for (const at of aTokens) {
        const m = tokenMatch(qt, at);
        if (m > 0) { overlapCount += m * 0.3; break; }
      }
    });

    const effectiveQueryLen = qSubstantive.length + qColors.length * 0.3;
    const queryCoverage = effectiveQueryLen > 0 ? overlapCount / effectiveQueryLen : 0;
    const aliasCoverage = overlapCount / aTokens.length;
    let score = (queryCoverage + aliasCoverage) > 0
      ? (2 * queryCoverage * aliasCoverage) / (queryCoverage + aliasCoverage)
      : 0;
    if (qSubstantive.length > 1 && unmatchedQueryTokens > 0) {
      score *= (1 - unmatchedQueryTokens * 0.3 / qSubstantive.length);
    }
    if (aTokens[0] && qSubstantive[0]) {
      if (tokenMatch(qSubstantive[0], aTokens[0]) >= 1.0) score += 0.08;
      else if (tokenMatch(qSubstantive[0], aTokens[0]) >= 0.8) score += 0.04;
    }

    if (entry.fdcId === 173723) console.log(`[173723] Token overlap match: a="${a}" -> final score = ${score}`);
    if (score > bestScore) bestScore = score;
  }
  return Math.min(bestScore, 1.0);
}

// Check fdcId 173723
const entry = COMMON_FOODS.find(f => f.fdcId === 173723);
console.log("Analyzing entry:", entry);
const score = matchScore("salmon", entry);
console.log("Final matchScore:", score);
