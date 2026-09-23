// Regression tests for actor identity, actor/action relationships, place names and
// generic versus specialist repatriation context. Written before the final Phase
// 2B-1 correction; they describe the required behaviour.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { parseKnowledgeBase } from '@/lib/knowledge-schema';
import { retrieve } from '@/lib/retrieval';
import { askChat, mockOpenAI } from './helpers/chat-route';

const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);

const CHARITY_FUNDING_LIMITATION = 'ma-financial-support-limitation';
const GENERIC_REPATRIATION = ['govuk-repatriation-and-funeral-decisions', 'ma-repatriation-advice'];
const SPECIALIST_AFTER_REPATRIATION = /post-mortem|coroner/;

function run(message: string) {
  const result = retrieve(message, knowledgeBase);
  return { ...result, ids: result.matches.map((entry) => entry.id) };
}

function assertFallback(message: string) {
  const result = run(message);
  assert.equal(result.fallbackUsed, true, `unexpectedly supported by ${result.ids.join(', ')}`);
  assert.deepEqual(result.ids, []);
}

function assertSupported(message: string) {
  const result = run(message);
  assert.equal(result.fallbackUsed, false, `unexpected fallback (${result.fallbackReason}) for "${message}"`);
  return result.ids;
}

// Either the question falls back, or its evidence includes the charity's own statement
// about funding. Generic lawyer or cost evidence alone must never answer it.
function assertCharityFundingIsSafe(message: string) {
  const result = run(message);
  if (!result.fallbackUsed) {
    assert.ok(result.ids.includes(CHARITY_FUNDING_LIMITATION), `charity limitation missing: ${result.ids.join(', ')}`);
  }
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

describe('charity funding keeps the actor identity', () => {
  test('"Can Murdered Abroad pay for a lawyer?" is supported with the charity funding limitation', () => {
    assert.ok(assertSupported('Can Murdered Abroad pay for a lawyer?').includes(CHARITY_FUNDING_LIMITATION));
  });

  for (const message of [
    'Will Murdered Abroad pay my legal fees?',
    'Can the charity help pay for legal advice?',
    'Does Murdered Abroad provide money for a lawyer?',
  ]) {
    test(`"${message}" either falls back or includes the charity funding limitation`, () => {
      assertCharityFundingIsSafe(message);
    });
  }
});

describe('unsupported actor/action combinations fall back', () => {
  for (const message of [
    'Can the police pay for my funeral?',
    'Can a lawyer conduct a post-mortem?',
    'Can the media investigate the murder?',
    'Can the court provide financial support?',
  ]) {
    test(`"${message}" falls back`, () => assertFallback(message));
  }

  test('"Can the charity pay court costs?" is only answered with the charity funding limitation', () => {
    assertCharityFundingIsSafe('Can the charity pay court costs?');
  });

  test('unsupported actor/action questions never reach the model', async (t) => {
    const calls = mockOpenAI(t);
    for (const message of ['Can the police pay for my funeral?', 'Can a lawyer conduct a post-mortem?']) {
      const { json } = await askChat(message);
      assert.equal(json.fallbackUsed, true, message);
    }
    assert.equal(calls.length, 0);
  });
});

describe('explicit limiting or positive relationship evidence is valid support', () => {
  test('"Can the police investigate abroad?" is answered by the police limitation', () => {
    assert.equal(assertSupported('Can the police investigate abroad?')[0], 'ma-police-in-england-and-wales');
  });

  test('"Can the UK government speed up the court case?" is answered by the government limitation alone', () => {
    // "court case" must not pull in the unrelated "case manager" passage.
    assert.deepEqual(assertSupported('Can the UK government speed up the court case?'), ['govuk-limits-of-uk-government-power']);
  });

  test('"Does Murdered Abroad provide financial support to families?" is led by the charity funding limitation', () => {
    assert.equal(assertSupported('Does Murdered Abroad provide financial support to families?')[0], CHARITY_FUNDING_LIMITATION);
  });

  test('"Does Murdered Abroad provide emotional support?" is led by the emotional-support passage', () => {
    assert.equal(assertSupported('Does Murdered Abroad provide emotional support?')[0], 'ma-emotional-support');
  });

  test('"Can the Homicide Service help with repatriation costs?" includes the Homicide Service cost passage', () => {
    assert.ok(
      assertSupported('Can the Homicide Service help with repatriation costs?').includes('govuk-financial-support-and-costs')
    );
  });
});

describe('proper-name bypasses are blocked but real places are recognised', () => {
  for (const message of ['Can I get support from Legal Aid?', 'Can I get financial support in Mortgage?']) {
    test(`"${message}" falls back`, () => assertFallback(message));
  }

  test('"My son was killed in France. What should I do first?" is led by first steps', () => {
    assert.equal(assertSupported('My son was killed in France. What should I do first?')[0], 'govuk-first-steps');
  });
});

describe('generic repatriation questions get repatriation guidance, not specialist passages', () => {
  for (const message of [
    'repatriation',
    'How do I bring my relative home?',
    'What help is available with repatriation?',
    'Can Murdered Abroad help with repatriation?',
  ]) {
    test(`"${message}" is led by repatriation guidance without post-mortem or coroner passages`, () => {
      const ids = assertSupported(message);
      assert.ok(GENERIC_REPATRIATION.includes(ids[0]), `lead was ${ids[0]}`);
      assert.ok(ids.includes('ma-repatriation-advice'), ids.join(', '));
      for (const id of ids) assert.doesNotMatch(id, SPECIALIST_AFTER_REPATRIATION, ids.join(', '));
    });
  }
});

describe('explicit after-repatriation questions keep specialist evidence', () => {
  test('"What happens after repatriation?" includes the coroner and post-mortem passages', () => {
    const ids = assertSupported('What happens after repatriation?');
    assert.ok(ids.includes('govuk-coroner-after-repatriation'), ids.join(', '));
    assert.ok(ids.includes('ma-post-mortem-after-repatriation'), ids.join(', '));
  });

  test('"Will there be another post-mortem after repatriation?" is led by the post-mortem passage', () => {
    assert.equal(assertSupported('Will there be another post-mortem after repatriation?')[0], 'ma-post-mortem-after-repatriation');
  });

  test('"What does the coroner do after repatriation?" is led by the coroner-after-repatriation passage', () => {
    assert.equal(assertSupported('What does the coroner do after repatriation?')[0], 'govuk-coroner-after-repatriation');
  });
});
