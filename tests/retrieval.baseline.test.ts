// Baseline: documents CURRENT retrieval behaviour of POST /api/chat.
// Cases marked KNOWN WEAKNESS assert behaviour that is incorrect and is expected
// to change in a later phase. Update those assertions deliberately when fixing.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { askChat, contextTitles, FALLBACK_PREFIX, mockOpenAI } from './helpers/chat-route';

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

describe('retrieval baseline', () => {
  test('"lawyers" retrieves the lawyers entry first', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('lawyers');

    assert.equal(calls.length, 1);
    assert.deepEqual(contextTitles(calls[0]), ['Lawyers abroad', 'Ongoing FCDO and consular support']);
    assert.equal(json.fallbackUsed, false);
  });

  test('KNOWN WEAKNESS: "lawyer" (singular) does not match "Lawyers abroad" and falls back', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('lawyer');

    assert.equal(calls.length, 0);
    assert.equal(json.fallbackUsed, true);
    assert.ok(json.answer.startsWith(FALLBACK_PREFIX));
  });

  test('KNOWN WEAKNESS: repeating "lawyer" inflates the score past the fallback threshold', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('lawyer lawyer lawyer lawyer');

    assert.equal(calls.length, 1);
    assert.deepEqual(contextTitles(calls[0]), ['Lawyers abroad']);
    assert.equal(json.fallbackUsed, false);
  });

  test('KNOWN WEAKNESS: "How much will that cost?" does not match "costs" and falls back', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('How much will that cost?');

    assert.equal(calls.length, 0);
    assert.equal(json.fallbackUsed, true);
    assert.ok(json.answer.startsWith(FALLBACK_PREFIX));
  });

  test('KNOWN WEAKNESS: out-of-scope passport question is sent to the model with unrelated context', async (t) => {
    const calls = mockOpenAI(t);
    const { json } = await askChat('Can the embassy renew my passport?');

    assert.equal(calls.length, 1);
    assert.deepEqual(contextTitles(calls[0]), ['Ongoing FCDO and consular support']);
    assert.equal(json.fallbackUsed, false);
  });

  test('KNOWN WEAKNESS: language question ranks the right entry first but includes unrelated entries', async (t) => {
    const calls = mockOpenAI(t);
    await askChat('What if I do not speak the language?');

    assert.equal(calls.length, 1);
    // "not" is not a stop word, so coroner/repatriation entries containing "not" are included.
    assert.deepEqual(contextTitles(calls[0]), [
      'What if I do not speak the language',
      'Coroner information from Murdered Abroad',
      'Repatriation advice from Murdered Abroad',
      'Coroner involvement after repatriation',
      'Post-mortem after repatriation',
    ]);
  });

  test('retrieval is deterministic for the same input', async (t) => {
    const calls = mockOpenAI(t);
    await askChat('What if I do not speak the language?');
    await askChat('What if I do not speak the language?');

    assert.deepEqual(contextTitles(calls[0]), contextTitles(calls[1]));
  });
});
