// Trust-boundary tests for model output: only a normally completed response may be
// accepted, and model-written answer text may not carry evidence IDs, citation
// markers or links. Written before the Phase 2B-2 acceptance correction.
import assert from 'node:assert/strict';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { validateGroundedOutput, type ModelOutput } from '@/lib/grounding';
import { parseKnowledgeBase } from '@/lib/knowledge-schema';
import { askChat, groundedContent, mockOpenAI } from './helpers/chat-route';

// The passages retrieval selected, as the validator receives them.
const SELECTED = parseKnowledgeBase(knowledgeBaseJson).filter((entry) => ['govuk-lawyers-abroad', 'ma-financial-support-limitation'].includes(entry.id));

const FALLBACK_ANSWER =
  'I could not find a clear answer in the approved source material.\n\nThe safest next step is to contact Murdered Abroad Charity directly: support@murdered-abroad.org.uk or helpline 0845 123 2384.\n\nYou can also contact the nearest British Embassy, High Commission or Consulate, or local police/authorities in the country involved. If there is immediate danger, contact emergency services immediately.';

const CONTACT_SOURCE = {
  title: 'How to contact Murdered Abroad Charity',
  sourceName: 'Murdered Abroad Charity',
  sourceUrl: 'https://www.murdered-abroad.org.uk/contact',
  category: 'charity_contact',
};

// Retrieval selects ma-financial-support-limitation and govuk-lawyers-abroad.
const QUESTION = 'Can Murdered Abroad pay for a lawyer?';
const GENERATED_TEXT = 'Generated answer text that must not be shown.';

function withText(text: string, finishReason: string | null = 'stop'): ModelOutput {
  return { kind: 'content', content: groundedContent([{ text, evidenceIds: ['govuk-lawyers-abroad'] }]), finishReason };
}

function outcome(output: ModelOutput) {
  const result = validateGroundedOutput(output, SELECTED);
  return result.outcome === 'rejected' ? `rejected:${result.reason}` : result.outcome;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

async function expectHiddenFallback(t: TestContext, options: Parameters<typeof mockOpenAI>[1], expectedReason: string) {
  const warnings = t.mock.method(console, 'warn', () => {});
  const calls = mockOpenAI(t, options);
  const { status, json } = await askChat(QUESTION);

  assert.equal(calls.length, 1);
  assert.equal(status, 200);
  assert.deepEqual(json, { answer: FALLBACK_ANSWER, sources: [CONTACT_SOURCE], fallbackUsed: true });

  const response = JSON.stringify(json);
  for (const leaked of ['Generated answer', 'govuk-lawyers-abroad', 'ma-financial-support-limitation', '"status"', 'segments', 'evil']) {
    assert.ok(!response.includes(leaked), `response leaked ${leaked}`);
  }

  assert.equal(warnings.mock.callCount(), 1);
  assert.deepEqual(warnings.mock.calls[0].arguments, ['Grounded answer not used:', expectedReason]);
}

describe('finish_reason: only "stop" may be accepted', () => {
  test('"stop" is accepted', () => {
    assert.equal(outcome(withText('A local lawyer may help.', 'stop')), 'answered');
  });

  for (const finishReason of ['length', 'content_filter', 'tool_calls', 'function_call', 'something_new', null]) {
    test(`${JSON.stringify(finishReason)} is rejected`, () => {
      assert.equal(outcome(withText('A local lawyer may help.', finishReason)), 'rejected:abnormal-finish-reason');
    });
  }

  test('a valid response with finish_reason "stop" reaches the user', async (t) => {
    mockOpenAI(t, { content: groundedContent([{ text: 'A local lawyer may help.', evidenceIds: ['govuk-lawyers-abroad'] }]) });
    const { json } = await askChat(QUESTION);
    assert.equal(json.fallbackUsed, false);
    assert.equal(json.answer, 'A local lawyer may help. [1]');
  });

  for (const finishReason of ['length', 'content_filter', 'tool_calls', 'something_new', null]) {
    test(`route: finish_reason ${JSON.stringify(finishReason)} gives the fixed fallback without exposing the answer`, async (t) => {
      const content = groundedContent([{ text: GENERATED_TEXT, evidenceIds: ['govuk-lawyers-abroad'] }]);
      await expectHiddenFallback(t, { content, finishReason }, 'abnormal-finish-reason');
    });
  }

  test('route: a missing finish_reason gives the fixed fallback without exposing the answer', async (t) => {
    const content = groundedContent([{ text: GENERATED_TEXT, evidenceIds: ['govuk-lawyers-abroad'] }]);
    await expectHiddenFallback(t, { content, omitFinishReason: true }, 'abnormal-finish-reason');
  });

  test('route: a refusal is still reported as a refusal', async (t) => {
    await expectHiddenFallback(t, { content: null, refusal: 'I cannot help with that.' }, 'refusal');
  });
});

describe('answer text may not carry evidence IDs', () => {
  for (const text of [
    'See govuk-lawyers-abroad for details.',
    'See ma-contact-support for details.',
    'See govuk-made-up-source for details.',
    'See ma-invented-evidence for details.',
    'See GOVUK-LAWYERS-ABROAD for details.',
    'Evidence (ma-financial-support-limitation) says so.',
  ]) {
    test(`rejects "${text}"`, () => assert.equal(outcome(withText(text)), 'rejected:metadata-in-text'));
  }

  test('recognises every evidence ID in the approved corpus', () => {
    for (const { id } of knowledgeBaseJson) {
      assert.equal(outcome(withText(`See ${id}.`)), 'rejected:metadata-in-text', id);
    }
  });
});

describe('answer text may not carry citation markers', () => {
  for (const text of [
    'Guaranteed payment [1]',
    'Guaranteed payment [12]',
    'Guaranteed payment [1,2]',
    'Guaranteed payment [1, 2]',
    'Guaranteed payment [ 1 , 2 ]',
    'Guaranteed payment [1][2]',
    'Guaranteed payment [1] [2]',
    'Guaranteed payment [1-3]',
    'Guaranteed payment [1; 2]',
  ]) {
    test(`rejects "${text}"`, () => assert.equal(outcome(withText(text)), 'rejected:metadata-in-text'));
  }
});

describe('answer text may not carry links or domains', () => {
  for (const text of [
    'Visit https://evil.example/help',
    'Visit http://evil.example/help',
    'Visit HTTPS://EVIL.EXAMPLE/help',
    'Visit www.evil.example/help',
    'Visit //evil.example/help',
    'Visit (//evil.example/help)',
    'Visit evil.example/help',
    'Visit evil.com for help.',
    'Visit gov.uk/guidance for help.',
    // No dotted domain: only the scheme and protocol-relative rules catch these.
    'Visit https://localhost/help',
    'Visit http://127.0.0.1/help',
    'Visit //localhost/help',
  ]) {
    test(`rejects "${text}"`, () => assert.equal(outcome(withText(text)), 'rejected:metadata-in-text'));
  }
});

describe('ordinary answer text is still accepted', () => {
  for (const text of [
    'A local lawyer may help [where available].',
    'Some documents may need translating [sic], e.g. certificates.',
    'GOV.UK says a local lawyer may help.',
    // Email addresses are accepted only when the cited evidence contains them; see
    // tests/grounding-email.test.ts.
    'The helpline is open 24/7 and/or by email.',
    'Costs may be £1,200.50 or more, i.e. significant.',
    'Some steps, such as 1 and 2, can take time.',
    'The U.K. coroner may be involved.',
  ]) {
    test(`accepts "${text}"`, () => assert.equal(outcome(withText(text)), 'answered'));
  }
});

describe('route: text bypasses give the fixed fallback without exposing the answer', () => {
  for (const text of ['See govuk-made-up-source.', 'Guaranteed payment [1, 2]', 'Visit //evil.example/help']) {
    test(`"${text}"`, async (t) => {
      await expectHiddenFallback(
        t,
        { content: groundedContent([{ text: `${GENERATED_TEXT} ${text}`, evidenceIds: ['govuk-lawyers-abroad'] }]) },
        'metadata-in-text'
      );
    });
  }
});
