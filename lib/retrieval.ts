// Keyword retrieval over the approved knowledge base.
import type { KnowledgeEntry } from '@/lib/knowledge-schema';

// Below this top score no entry is considered relevant and the fixed fallback is used.
export const FALLBACK_SCORE_THRESHOLD = 4;
export const MAX_CONTEXT_ENTRIES = 5;

export const SCORE_WEIGHTS = {
  title: 5,
  category: 4,
  sourceName: 2,
  content: 1,
} as const;

const stopWords = new Set([
  'a',
  'about',
  'after',
  'an',
  'and',
  'are',
  'can',
  'do',
  'for',
  'from',
  'has',
  'have',
  'help',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'or',
  'our',
  'should',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'who',
  'with',
]);

export type ScoredEntry = {
  entry: KnowledgeEntry;
  score: number;
};

export type RetrievalResult = {
  // Entries with a positive score, highest first, capped at MAX_CONTEXT_ENTRIES.
  // Populated even when fallbackUsed is true; callers should check fallbackUsed first.
  matches: KnowledgeEntry[];
  topScore: number;
  fallbackUsed: boolean;
};

export function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

export function scoreEntry(entry: KnowledgeEntry, messageTokens: string[]) {
  const title = tokenize(entry.title);
  const category = tokenize(entry.category);
  const sourceName = tokenize(entry.sourceName);
  const content = tokenize(entry.content);

  return messageTokens.reduce((score, token) => {
    let nextScore = score;
    if (title.includes(token)) nextScore += SCORE_WEIGHTS.title;
    if (category.includes(token)) nextScore += SCORE_WEIGHTS.category;
    if (sourceName.includes(token)) nextScore += SCORE_WEIGHTS.sourceName;
    if (content.includes(token)) nextScore += SCORE_WEIGHTS.content;
    return nextScore;
  }, 0);
}

// Scores every entry against the message, highest first. Ties keep knowledge-base order.
export function rankEntries(message: string, entries: KnowledgeEntry[]): ScoredEntry[] {
  const messageTokens = tokenize(message);
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, messageTokens) }))
    .sort((a, b) => b.score - a.score);
}

export function retrieve(message: string, entries: KnowledgeEntry[]): RetrievalResult {
  const ranked = rankEntries(message, entries);
  const topScore = ranked[0]?.score ?? 0;

  return {
    matches: ranked
      .filter((item) => item.score > 0)
      .slice(0, MAX_CONTEXT_ENTRIES)
      .map((item) => item.entry),
    topScore,
    fallbackUsed: topScore < FALLBACK_SCORE_THRESHOLD,
  };
}
