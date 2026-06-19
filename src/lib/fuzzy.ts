/**
 * Lightweight subsequence fuzzy match. Returns a score (higher = better) when
 * every char of `query` appears in `text` in order, or null when it doesn't.
 * Consecutive matches are rewarded so tighter matches rank higher.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatch = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += ti === lastMatch + 1 ? 3 : 1; // bonus for adjacency
      if (ti === 0) score += 2; // bonus for matching the start
      lastMatch = ti;
      qi++;
    }
  }
  return qi === q.length ? score : null;
}
