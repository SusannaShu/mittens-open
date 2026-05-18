const STOP_WORDS = new Set(['likely', 'dark', 'light', 'other', 'red', 'orange', 'green', 'yellow', 'white', 'brown', 'black', 'speck']);
function normalizeName(name) {
  let n = name.toLowerCase().trim();
  n = n.replace(/\([^)]*\)/g, '').trim();
  n = n.replace(/^(fresh|raw|organic|dried|frozen|canned|cooked|roasted|grilled|steamed|baked|fried)\s+/g, '');
  n = n.replace(/\s+(sliced|diced|chopped|minced|whole|pieces|chunks)$/g, '');
  if (n.endsWith('ies') && n.length > 4) n = n.slice(0, -3) + 'y';
  else if (n.endsWith('es') && n.length > 4) n = n.slice(0, -2);
  else if (n.endsWith('s') && n.length > 3) n = n.slice(0, -1);
  return n;
}
const q = normalizeName("leafy greens");
const qTokens = q.split(/[\s/,]+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));
console.log(qTokens);
