import { useCallback } from 'react';

// ── Stable ID ────────────────────────────────────────────────────
export function memoryId(phrase) {
  return phrase.toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 60);
}

// ── Fuzzy score 0–1 ──────────────────────────────────────────────
export function fuzzyScore(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;

  const wa = new Set(a.split(/\s+/));
  const wb = new Set(b.split(/\s+/));
  const overlap = [...wa].filter(w => wb.has(w)).length;
  const union   = new Set([...wa, ...wb]).size;
  const jaccard = union === 0 ? 0 : overlap / union;

  const bigrams = s => {
    const bg = new Set();
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
    return bg;
  };
  const ba = bigrams(a), bb = bigrams(b);
  const biOverlap = [...ba].filter(g => bb.has(g)).length;
  const biUnion   = new Set([...ba, ...bb]).size;
  const biScore   = biUnion ? biOverlap / biUnion : 0;

  return (jaccard * 0.6) + (biScore * 0.4);
}

// ── Hook ─────────────────────────────────────────────────────────
export function useMemory(memory, setMemory) {

  const memoryMatch = useCallback((query, threshold = 0.55) => {
    if (!query.trim() || !memory.length) return [];
    return memory
      .map(e => ({ ...e, score: fuzzyScore(query, e.phrase) }))
      .filter(e => e.score >= threshold)
      .sort((a, b) => b.score !== a.score
        ? b.score - a.score
        : (b.useCount || 0) - (a.useCount || 0))
      .slice(0, 5);
  }, [memory]);

  const memoryExactMatch = useCallback((query) => {
    const hits = memoryMatch(query, 0.95);
    return hits.length ? hits[0] : null;
  }, [memoryMatch]);

  const memoryFuzzyMatch = useCallback((query) => {
    const hits = memoryMatch(query, 0.60).filter(m => m.score < 0.95);
    return hits.length ? hits[0] : null;
  }, [memoryMatch]);

  const memorySave = useCallback(async (phrase, action) => {
    phrase = phrase.trim();
    if (!phrase || !action?.action) return;

    const id = memoryId(phrase);
    const entry = {
      id, phrase, action,
      useCount: (memory.find(e => e.id === id)?.useCount || 0) + 1,
      lastUsed: Date.now(),
    };

    setMemory(prev => {
      const idx = prev.findIndex(e => e.id === id);
      const next = idx >= 0
        ? prev.map((e, i) => i === idx ? entry : e)
        : [entry, ...prev];
      return next;
    });

    try { await window.aria.memorySaveEntry(entry); }
    catch(e) { console.warn('Memory save error:', e); }
  }, [memory, setMemory]);

  const memoryDelete = useCallback(async (id) => {
    setMemory(prev => prev.filter(e => e.id !== id));
    try { await window.aria.memoryDeleteEntry(id); } catch(_) {}
  }, [setMemory]);

  const memoryClearAll = useCallback(async () => {
    setMemory([]);
    try { await window.aria.memoryClear(); } catch(_) {}
  }, [setMemory]);

  const autocompleteMatches = useCallback((query) => {
    if (!query?.trim() || query.length < 2) return [];
    return memoryMatch(query, 0.45);
  }, [memoryMatch]);

  return {
    memoryMatch,
    memoryExactMatch,
    memoryFuzzyMatch,
    memorySave,
    memoryDelete,
    memoryClearAll,
    autocompleteMatches,
  };
}
