// Acceptance tests for approved-source retrieval (Phase 2B-1). Written before the
// retrieval algorithm was changed; they describe the desired production behaviour.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { parseKnowledgeBase } from '@/lib/knowledge-schema';
import { retrieve } from '@/lib/retrieval';

const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);

function matchIds(message: string) {
  return retrieve(message, knowledgeBase).matches.map((entry) => entry.id);
}

describe('retrieval acceptance', () => {
  test('singular "lawyer" retrieves the same guidance as "lawyers"', () => {
    const singular = retrieve('lawyer', knowledgeBase);

    assert.equal(singular.fallbackUsed, false);
    assert.ok(matchIds('lawyer').includes('govuk-lawyers-abroad'));
    assert.deepEqual(matchIds('lawyer'), matchIds('lawyers'));
  });

  test('repeating a word does not change retrieval', () => {
    assert.deepEqual(retrieve('lawyer lawyer lawyer lawyer', knowledgeBase), retrieve('lawyer', knowledgeBase));
  });

  test('KNOWN LIMITATION: contextless follow-up "How much will that cost?" still falls back', () => {
    // The referent of "that" lives in an earlier turn; conversation context is a later phase.
    const result = retrieve('How much will that cost?', knowledgeBase);

    assert.equal(result.fallbackUsed, true);
    assert.deepEqual(result.matches, []);
  });

  test('off-topic "Can the embassy renew my passport?" is not covered by the word "embassy" alone', () => {
    const result = retrieve('Can the embassy renew my passport?', knowledgeBase);

    assert.equal(result.fallbackUsed, true);
    assert.deepEqual(result.matches, []);
  });

  test('language question retrieves only the language guidance', () => {
    const result = retrieve('What if I do not speak the language?', knowledgeBase);

    assert.equal(result.fallbackUsed, false);
    assert.deepEqual(matchIds('What if I do not speak the language?'), ['govuk-language-and-interpreters']);
    for (const id of matchIds('What if I do not speak the language?')) {
      assert.doesNotMatch(id, /coroner|post-mortem|repatriation/);
    }
  });

  test('identical input and corpus give identical results and ordering', () => {
    const freshCorpus = parseKnowledgeBase(structuredClone(knowledgeBaseJson));
    for (const message of ['Who can help with repatriation?', 'lawyer', 'Can the embassy renew my passport?']) {
      assert.deepEqual(retrieve(message, knowledgeBase), retrieve(message, knowledgeBase));
      assert.deepEqual(retrieve(message, knowledgeBase), retrieve(message, freshCorpus));
    }
  });
});

describe('existing supported questions remain supported', () => {
  // The chat UI's example questions plus previously supported baseline queries.
  for (const [message, expectedId] of [
    ['What should I do first?', 'govuk-first-steps'],
    ['Who should I contact if this happened abroad?', 'govuk-who-to-contact'],
    ['Can the embassy help me?', 'govuk-ongoing-consular-support'],
    ['What if I do not speak the language?', 'govuk-language-and-interpreters'],
    ['Who can help with repatriation?', 'govuk-repatriation-and-funeral-decisions'],
    ['Who can help with repatriation?', 'ma-repatriation-advice'],
    ['lawyers', 'govuk-lawyers-abroad'],
  ] as const) {
    test(`"${message}" is supported and includes ${expectedId}`, () => {
      const result = retrieve(message, knowledgeBase);

      assert.equal(result.fallbackUsed, false);
      assert.ok(matchIds(message).includes(expectedId), `got ${matchIds(message).join(', ')}`);
      assert.ok(result.matches.length <= 5);
    });
  }
});
