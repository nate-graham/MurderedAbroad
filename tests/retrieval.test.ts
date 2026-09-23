// Direct unit tests for lib/retrieval.ts. These pin the current behaviour;
// KNOWN WEAKNESS cases are expected to change in a later phase.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { parseKnowledgeBase, type KnowledgeEntry } from '@/lib/knowledge-schema';
import {
  FALLBACK_SCORE_THRESHOLD,
  MAX_CONTEXT_ENTRIES,
  rankEntries,
  retrieve,
  scoreEntry,
  tokenize,
} from '@/lib/retrieval';

function entry(overrides: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    title: 'Untitled',
    sourceName: 'Source',
    sourceUrl: 'https://example.org/',
    category: 'none',
    content: 'nothing',
    ...overrides,
  };
}

describe('tokenize', () => {
  test('lowercases, strips punctuation and removes stop words and short tokens', () => {
    assert.deepEqual(tokenize('What if I do NOT speak the Language?'), ['not', 'speak', 'language']);
  });

  test('keeps hyphens, splits underscores and dots', () => {
    assert.deepEqual(tokenize('self-harm first_steps GOV.UK'), ['self-harm', 'first', 'steps', 'gov']);
  });

  test('keeps duplicate tokens', () => {
    assert.deepEqual(tokenize('lawyer lawyer'), ['lawyer', 'lawyer']);
  });

  test('returns no tokens for empty or stop-word-only input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize('what should I do?'), []);
  });

  test('KNOWN WEAKNESS: no stemming', () => {
    assert.deepEqual(tokenize('lawyer lawyers'), ['lawyer', 'lawyers']);
  });
});

describe('scoreEntry', () => {
  const sample = entry({
    title: 'Alpha title',
    category: 'beta_cat',
    sourceName: 'Gamma Source',
    content: 'delta words alpha',
  });

  test('weights title 5, category 4, source name 2, content 1', () => {
    assert.equal(scoreEntry(sample, ['alpha']), 6);
    assert.equal(scoreEntry(sample, ['beta']), 4);
    assert.equal(scoreEntry(sample, ['gamma']), 2);
    assert.equal(scoreEntry(sample, ['delta']), 1);
    assert.equal(scoreEntry(sample, ['zzz']), 0);
  });

  test('KNOWN WEAKNESS: repeated query tokens are counted each time', () => {
    assert.equal(scoreEntry(sample, ['alpha', 'alpha']), 12);
  });
});

describe('retrieve', () => {
  test('uses a threshold of 4 and a limit of 5', () => {
    assert.equal(FALLBACK_SCORE_THRESHOLD, 4);
    assert.equal(MAX_CONTEXT_ENTRIES, 5);
  });

  test('top score below the threshold uses the fallback but still reports matches', () => {
    const scoresThree = entry({ sourceName: 'Gamma', content: 'gamma' });
    const result = retrieve('gamma', [scoresThree]);

    assert.equal(result.topScore, 3);
    assert.equal(result.fallbackUsed, true);
    assert.deepEqual(result.matches, [scoresThree]);
  });

  test('top score equal to the threshold does not use the fallback', () => {
    const scoresFour = entry({ category: 'gamma' });
    const result = retrieve('gamma', [scoresFour]);

    assert.equal(result.topScore, 4);
    assert.equal(result.fallbackUsed, false);
  });

  test('no entries gives a top score of 0 and uses the fallback', () => {
    assert.deepEqual(retrieve('anything', []), { matches: [], topScore: 0, fallbackUsed: true });
  });

  test('excludes zero-score entries and orders by score', () => {
    const low = entry({ title: 'low', content: 'gamma' });
    const none = entry({ title: 'none' });
    const high = entry({ title: 'gamma' });
    const result = retrieve('gamma', [low, none, high]);

    assert.deepEqual(result.matches, [high, low]);
  });

  test('caps matches at five and keeps knowledge-base order for ties', () => {
    const entries = Array.from({ length: 7 }, (_, index) => entry({ title: `entry ${index}`, content: 'gamma' }));
    const result = retrieve('gamma', entries);

    assert.deepEqual(result.matches, entries.slice(0, 5));
  });

  test('rankEntries returns every entry with its score', () => {
    const a = entry({ title: 'gamma' });
    const b = entry({});
    assert.deepEqual(rankEntries('gamma', [b, a]), [
      { entry: a, score: 5 },
      { entry: b, score: 0 },
    ]);
  });
});

describe('retrieve against the checked-in knowledge base', () => {
  const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);

  test('"lawyers" matches the same entries as the route baseline', () => {
    const result = retrieve('lawyers', knowledgeBase);

    assert.equal(result.topScore, 10);
    assert.equal(result.fallbackUsed, false);
    assert.deepEqual(
      result.matches.map((match) => match.title),
      ['Lawyers abroad', 'Ongoing FCDO and consular support']
    );
  });

  test('KNOWN WEAKNESS: "lawyer" scores below the threshold', () => {
    const result = retrieve('lawyer', knowledgeBase);

    assert.equal(result.topScore, 1);
    assert.equal(result.fallbackUsed, true);
  });
});
