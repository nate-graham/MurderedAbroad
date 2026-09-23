// Baseline: documents CURRENT retrieval behaviour of POST /api/chat.
// Cases marked KNOWN WEAKNESS assert behaviour that is incorrect and is expected
// to change in a later phase. Update those assertions deliberately when fixing.
// Phase 2B-1 fixed the singular/plural, repetition, keyword-collision and
// unrelated-context cases below.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { askChat, contextTitles, FALLBACK_PREFIX, mockOpenAI } from './helpers/chat-route';

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

describe('retrieval baseline', () => {
  test('"lawyers" retrieves only the lawyers entry', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('lawyers');

    assert.equal(calls.length, 1);
    // "Ongoing FCDO and consular support" only mentions lawyers in passing and is below
    // the relative score floor.
    assert.deepEqual(contextTitles(calls[0]), ['Lawyers abroad']);
    assert.equal(json.fallbackUsed, false);
  });

  test('"lawyer" (singular) retrieves the same context as "lawyers"', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('lawyer');
    await askChat('lawyers');

    assert.equal(calls.length, 2);
    assert.deepEqual(contextTitles(calls[0]), ['Lawyers abroad']);
    assert.deepEqual(contextTitles(calls[0]), contextTitles(calls[1]));
    assert.equal(json.fallbackUsed, false);
  });

  test('repeating "lawyer" gives the same context as asking once', async (t) => {
    const calls = mockOpenAI(t);
    await askChat('lawyer lawyer lawyer lawyer');
    await askChat('lawyer');

    assert.equal(calls.length, 2);
    assert.deepEqual(contextTitles(calls[0]), contextTitles(calls[1]));
  });

  test('KNOWN WEAKNESS: contextless follow-up "How much will that cost?" falls back until conversation context exists', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('How much will that cost?');

    assert.equal(calls.length, 0);
    assert.equal(json.fallbackUsed, true);
    assert.ok(json.answer.startsWith(FALLBACK_PREFIX));
  });

  test('out-of-scope passport question falls back without calling the model', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('Can the embassy renew my passport?');

    assert.equal(calls.length, 0);
    assert.equal(json.fallbackUsed, true);
    assert.ok(json.answer.startsWith(FALLBACK_PREFIX));
  });

  test('language question sends only the language entry to the model', async (t) => {
    const calls = mockOpenAI(t);
    await askChat('What if I do not speak the language?');

    assert.equal(calls.length, 1);
    assert.deepEqual(contextTitles(calls[0]), ['What if I do not speak the language']);
  });

  test('retrieval is deterministic for the same input', async (t) => {
    const calls = mockOpenAI(t);
    await askChat('What if I do not speak the language?');
    await askChat('What if I do not speak the language?');

    assert.deepEqual(contextTitles(calls[0]), contextTitles(calls[1]));
  });
});
