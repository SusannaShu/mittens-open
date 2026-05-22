/**
 * Test the improved matching against the problem foods from the screenshot.
 */
const { COMMON_FOODS } = require('./lib/data/commonFoods');

// ── Inline the improved algorithm (mirrors nutrientEstimator.ts) ──

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
    if (a === q || a === qStemmed) return 1.0;

    const aWords = a.split(/[\s,]+/).filter(t => t.length > 1);
    if (aWords.length === 1 && qTokens.length === 1) {
      if (stemToken(aWords[0]) === stemToken(qTokens[0])) {
        bestScore = Math.max(bestScore, 0.98);
        continue;
      }
    }

    if (a.startsWith(q + ',') || a.startsWith(q + ' ')) {
      bestScore = Math.max(bestScore, 0.95);
      continue;
    }
    if (a.startsWith(qStemmed + ',') || a.startsWith(qStemmed + ' ')) {
      bestScore = Math.max(bestScore, 0.95);
      continue;
    }
    {
      const firstAToken = aWords[0];
      if (firstAToken && qTokens.length === 1 && stemToken(firstAToken) === stemToken(qTokens[0])) {
        const specificity = Math.max(0.85, 0.95 - (aWords.length - 1) * 0.03);
        if (specificity > bestScore) bestScore = specificity;
        continue;
      }
    }

    if (a.startsWith(q)) {
      bestScore = Math.max(bestScore, 0.9);
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

    if (score > bestScore) bestScore = score;
  }
  return Math.min(bestScore, 1.0);
}
const FOOD_SYNONYMS = {
  'sandwich bread': ['bread, white', 'bread, wheat', 'bread, whole-wheat'],
  'white bread': ['bread, white'],
  'wheat bread': ['bread, wheat'],
  'whole wheat bread': ['bread, whole-wheat'],
  'multigrain bread': ['bread, multi-grain'],
  'sourdough': ['bread, french or vienna'],
  'toast': ['bread, white', 'bread, wheat'],
  'oj': ['orange juice'],
  'orange juice': ['orange juice, raw'],
  'apple juice': ['apple juice, canned or bottled'],
  'chicken breast': ['chicken, broilers or fryers, breast'],
  'chicken thigh': ['chicken, broilers or fryers, thigh'],
  'ground beef': ['beef, ground'],
  'steak': ['beef, top sirloin'],
  'bacon': ['pork, cured, bacon'],
  'ham': ['pork, cured, ham'],
  'hot dog': ['frankfurter, beef'],
  'french fries': ['potatoes, french fried'],
  'fries': ['potatoes, french fried'],
  'mashed potatoes': ['potatoes, mashed'],
  'sweet potato': ['sweet potato, raw'],
  'bell pepper': ['peppers, sweet'],
  'green beans': ['beans, snap, green'],
  'corn on the cob': ['corn, sweet, yellow'],
  'peanut butter': ['peanut butter, smooth'],
  'cream cheese': ['cream cheese'],
  'sour cream': ['cream, sour'],
  'cottage cheese': ['cheese, cottage'],
  'mac and cheese': ['macaroni and cheese'],
  'grilled cheese': ['cheese sandwich'],
  'pb&j': ['peanut butter, smooth'],
  'oatmeal': ['cereals, oats, instant'],
  'granola': ['cereals, granola'],
  'scrambled eggs': ['egg, whole, cooked, scrambled'],
  'hard boiled egg': ['egg, whole, cooked, hard-boiled'],
  'fried egg': ['egg, whole, cooked, fried'],
  'sunny side up': ['egg, whole, cooked, fried'],
  'walnut': ['nuts, walnuts, english'],
  'walnuts': ['nuts, walnuts, english'],
  'almond': ['nuts, almonds'],
  'almonds': ['nuts, almonds'],
  'cashew': ['nuts, cashew nuts, raw'],
  'cashews': ['nuts, cashew nuts, raw'],
  'pecan': ['nuts, pecans'],
  'pecans': ['nuts, pecans'],
};

function resolveSearchTerms(foodName) {
  const normalized = normalizeName(foodName);
  const terms = [foodName];
  const synonyms = FOOD_SYNONYMS[normalized];
  if (synonyms) {
    terms.push(...synonyms);
  }
  for (const [key, vals] of Object.entries(FOOD_SYNONYMS)) {
    if (key !== normalized && normalized.includes(key)) {
      terms.push(...vals);
    }
  }
  return [...new Set(terms)];
}

function lookupUSDAAll(foodName, threshold = 0.4, maxResults = 8) {
  const searchTerms = resolveSearchTerms(foodName);
  const matches = new Map();
  for (const term of searchTerms) {
    for (const entry of COMMON_FOODS) {
      const score = matchScore(term, entry);
      if (score >= threshold) {
        const existing = matches.get(entry.fdcId);
        if (!existing || score > existing.score) {
          matches.set(entry.fdcId, { name: entry.name, category: entry.category, score });
        }
      }
    }
  }
  return Array.from(matches.values()).sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
    const aRaw = a.name.toLowerCase().includes(', raw') ? 1 : 0;
    const bRaw = b.name.toLowerCase().includes(', raw') ? 1 : 0;
    if (bRaw !== aRaw) return bRaw - aRaw;
    return a.name.length - b.name.length;
  }).slice(0, maxResults);
}

// ── Test the problem foods from the screenshot ──

const problemFoods = [
  { query: 'spinach',   wrongMatch: 'Spaghetti, spinach, dry (a grain!)' },
  { query: 'broccoli',  wrongMatch: 'Soup, broccoli cheese, canned' },
  { query: 'salmon',    wrongMatch: 'Fish oil, salmon' },
  { query: 'walnut',    wrongMatch: 'Oil, walnut' },
  { query: 'avocado',   wrongMatch: 'Oil, avocado' },
  { query: 'orange',    wrongMatch: 'a fortified beverage (0 matches!)' },
  { query: 'almond',    wrongMatch: 'Oil, almond' },
];

console.log('═══════════════════════════════════════════════════════════════');
console.log('  TESTING PROBLEM FOODS FROM SCREENSHOT');
console.log('  Old algorithm → New algorithm');
console.log('═══════════════════════════════════════════════════════════════\n');

for (const { query, wrongMatch } of problemFoods) {
  const results = lookupUSDAAll(query);
  const top = results[0];
  
  console.log(`🔍 "${query}"`);
  console.log(`   ❌ OLD: ${wrongMatch}`);
  if (top) {
    console.log(`   ✅ NEW: ${(top.score * 100).toFixed(0)}% "${top.name}" [${top.category}]`);
  } else {
    console.log(`   ❌ NEW: No matches found`);
  }
  
  // Show top 5 candidates
  console.log('   Candidates:');
  for (let i = 0; i < Math.min(5, results.length); i++) {
    const r = results[i];
    const marker = i === 0 ? '→' : ' ';
    console.log(`   ${marker} ${i+1}. ${(r.score * 100).toFixed(0)}% "${r.name}" [${r.category}]`);
  }
  console.log('');
}
