// Regression tests for the Phase 2B-1 review findings. Written before the coverage
// decision was corrected; they describe the required behaviour.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { parseKnowledgeBase } from '@/lib/knowledge-schema';
import { retrieve } from '@/lib/retrieval';

const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);

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
  assert.equal(result.fallbackUsed, false, `unexpected fallback for "${message}"`);
  assert.ok(result.ids.length >= 1 && result.ids.length <= 5, `got ${result.ids.length} entries`);
  return result.ids;
}

const REPATRIATION_IDS = ['govuk-repatriation-and-funeral-decisions', 'ma-repatriation-advice'];

describe('unsupported subjects are not authorised by generic approved words', () => {
  for (const message of [
    'Can I get financial support for a mortgage?',
    'Can I get financial support for tuition?',
    'What can the embassy and a lawyer do about my passport?',
    'Can I get legal advice about divorce?',
  ]) {
    test(`"${message}" falls back`, () => assertFallback(message));
  }
});

describe('supported paraphrases and conversational wording do not fall back', () => {
  test('"Must I appoint a lawyer?" is led by the lawyers guidance', () => {
    assert.equal(assertSupported('Must I appoint a lawyer?')[0], 'govuk-lawyers-abroad');
  });

  test('"How can I bring my brother home?" retrieves repatriation guidance', () => {
    const ids = assertSupported('How can I bring my brother home?');
    assert.ok(REPATRIATION_IDS.includes(ids[0]), `primary was ${ids[0]}`);
  });

  test('"What if I cannot afford repatriation?" retrieves repatriation and cost guidance', () => {
    const ids = assertSupported('What if I cannot afford repatriation?');
    assert.ok(ids.includes('ma-repatriation-advice'), ids.join(', '));
    assert.ok(ids.includes('govuk-financial-support-and-costs'), ids.join(', '));
  });

  test('"Who will pay for a lawyer?" retrieves lawyers and cost guidance', () => {
    const ids = assertSupported('Who will pay for a lawyer?');
    assert.ok(ids.includes('govuk-lawyers-abroad'), ids.join(', '));
    assert.ok(ids.includes('govuk-financial-support-and-costs'), ids.join(', '));
  });

  test('emotional framing does not hide a lawyer question', () => {
    const ids = assertSupported('I am confused and overwhelmed, please explain how I can find a lawyer.');
    assert.equal(ids[0], 'govuk-lawyers-abroad');
  });

  test('family and situation framing does not hide a first-steps question', () => {
    const ids = assertSupported('My sister was killed overseas and I need someone to explain the first steps.');
    assert.equal(ids[0], 'govuk-first-steps');
  });

  test('"What should I do first after my father was murdered abroad?" is led by first steps', () => {
    assert.equal(assertSupported('What should I do first after my father was murdered abroad?')[0], 'govuk-first-steps');
  });

  test('polite framing does not hide a repatriation question', () => {
    const ids = assertSupported('I would really appreciate some guidance about repatriation.');
    assert.ok(REPATRIATION_IDS.includes(ids[0]), `primary was ${ids[0]}`);
  });
});

describe('reference handling', () => {
  for (const message of [
    'How much will that cost?',
    'How much will it cost?',
    'How much will this cost?',
    'Can they help with repatriation?',
    'Can they pay repatriation costs?',
  ]) {
    test(`KNOWN LIMITATION: "${message}" falls back until conversation context exists`, () => assertFallback(message));
  }

  test('"Can Murdered Abroad help with repatriation?" is supported', () => {
    assert.ok(assertSupported('Can Murdered Abroad help with repatriation?').includes('ma-repatriation-advice'));
  });

  test('"Who should I contact if this happened abroad?" is supported', () => {
    const ids = assertSupported('Who should I contact if this happened abroad?');
    assert.ok(ids.includes('govuk-who-to-contact'), ids.join(', '));
    assert.ok(ids.includes('ma-contact-support'), ids.join(', '));
  });
});

describe('context quality', () => {
  test('"What practical support does Murdered Abroad provide?" is led by the practical-support passage', () => {
    const ids = assertSupported('What practical support does Murdered Abroad provide?');
    assert.equal(ids[0], 'ma-practical-support');
    for (const id of ids) {
      assert.doesNotMatch(id, /fcdo/, `generic FCDO evidence selected: ${ids.join(', ')}`);
    }
  });

  test('"legal advice" keeps the complementary legal-cost evidence', () => {
    const ids = assertSupported('legal advice');
    assert.ok(ids.includes('ma-no-legal-advice-disclaimer'), ids.join(', '));
    assert.ok(ids.includes('govuk-financial-support-and-costs'), ids.join(', '));
  });

  test('"Can the charity help me bring my loved one home?" is led by repatriation guidance', () => {
    const ids = assertSupported('Can the charity help me bring my loved one home?');
    assert.ok([...REPATRIATION_IDS, 'ma-practical-support'].includes(ids[0]), `primary was ${ids[0]}`);
    assert.ok(ids.some((id) => REPATRIATION_IDS.includes(id)), ids.join(', '));
    assert.doesNotMatch(ids[0], /coroner|post-mortem/);
  });
});
