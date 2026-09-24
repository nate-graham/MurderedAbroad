// Route-level tests for grounded structured answers: citations, displayed sources and
// safe fallback when model output cannot be trusted. OpenAI is always mocked.
import assert from 'node:assert/strict';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import { askChat, evidenceIdsInRequest, FALLBACK_PREFIX, groundedContent, mockOpenAI } from './helpers/chat-route';

const FALLBACK_ANSWER =
  'I could not find a clear answer in the approved source material.\n\nThe safest next step is to contact Murdered Abroad Charity directly: support@murdered-abroad.org.uk or helpline 0845 123 2384.\n\nYou can also contact the nearest British Embassy, High Commission or Consulate, or local police/authorities in the country involved. If there is immediate danger, contact emergency services immediately.';

const CONTACT_SOURCE = {
  title: 'How to contact Murdered Abroad Charity',
  sourceName: 'Murdered Abroad Charity',
  sourceUrl: 'https://www.murdered-abroad.org.uk/contact',
  category: 'charity_contact',
};

const GOV_UK_GUIDE_URL =
  'https://www.gov.uk/government/publications/murder-and-manslaughter-abroad-family-information-guide/murder-and-manslaughter-abroad-family-information-guide-for-england-and-wales';

// Retrieval (unchanged in this phase) selects:
//   CHARITY_QUESTION        -> ma-financial-support-limitation, govuk-lawyers-abroad
//   REPATRIATION_QUESTION   -> govuk-repatriation-and-funeral-decisions, ma-repatriation-advice
//   SAME_PUBLISHER_QUESTION -> govuk-limits-of-uk-government-power, govuk-court-proceedings-abroad
const CHARITY_QUESTION = 'Can Murdered Abroad pay for a lawyer?';
const REPATRIATION_QUESTION = 'Who can help with repatriation?';
const SAME_PUBLISHER_QUESTION = 'How long will the trial take?';

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

async function expectSafeFallback(t: TestContext, content: string | null, options: { refusal?: string } = {}) {
  const warnings = t.mock.method(console, 'warn', () => {});
  const calls = mockOpenAI(t, { content, ...options });
  const { status, json } = await askChat(CHARITY_QUESTION);

  assert.equal(calls.length, 1);
  assert.equal(status, 200);
  assert.deepEqual(json, { answer: FALLBACK_ANSWER, sources: [CONTACT_SOURCE], fallbackUsed: true });
  assert.equal(warnings.mock.callCount(), 1);
  const logged = JSON.stringify(warnings.mock.calls[0].arguments);
  assert.ok(!logged.includes('lawyer'), 'the user question must not be logged');
  return warnings.mock.calls[0].arguments;
}

describe('grounded answers', () => {
  test('one segment with one evidence ID is rendered with a server citation and its source', async (t) => {
    mockOpenAI(t, {
      content: groundedContent([
        { text: 'Murdered Abroad cannot provide financial support to individual families.', evidenceIds: ['ma-financial-support-limitation'] },
      ]),
    });
    const { status, json } = await askChat(CHARITY_QUESTION);

    assert.equal(status, 200);
    assert.deepEqual(json, {
      answer: 'Murdered Abroad cannot provide financial support to individual families. [1]',
      sources: [
        {
          citation: 1,
          title: 'Murdered Abroad financial limitation',
          sourceName: 'Murdered Abroad Charity',
          sourceUrl: 'https://www.murdered-abroad.org.uk/support',
          category: 'financial_support',
        },
      ],
      fallbackUsed: false,
    });
  });

  test('several segments, reused and multiple evidence IDs get server-assigned numbers', async (t) => {
    mockOpenAI(t, {
      content: groundedContent([
        { text: 'The charity cannot fund individual families.', evidenceIds: ['ma-financial-support-limitation'] },
        { text: 'You could consider appointing a local lawyer.', evidenceIds: ['govuk-lawyers-abroad'] },
        { text: 'Both points come from approved guidance.', evidenceIds: ['govuk-lawyers-abroad', 'ma-financial-support-limitation'] },
      ]),
    });
    const { json } = await askChat(CHARITY_QUESTION);

    assert.equal(
      json.answer,
      'The charity cannot fund individual families. [1]\n\nYou could consider appointing a local lawyer. [2]\n\nBoth points come from approved guidance. [1][2]'
    );
    assert.deepEqual(
      json.sources.map((source) => [source.citation, source.title]),
      [
        [1, 'Murdered Abroad financial limitation'],
        [2, 'Lawyers abroad'],
      ]
    );
  });

  test('retrieved passages the model did not cite are not shown', async (t) => {
    const calls = mockOpenAI(t, {
      content: groundedContent([{ text: 'Repatriation guidance is available.', evidenceIds: ['ma-repatriation-advice'] }]),
    });
    const { json } = await askChat(REPATRIATION_QUESTION);

    assert.ok(evidenceIdsInRequest(calls[0]).length > 1, 'the question should retrieve several passages');
    assert.deepEqual(
      json.sources.map((source) => source.title),
      ['Repatriation advice from Murdered Abroad']
    );
  });

  test('two cited passages from the same publisher both appear', async (t) => {
    mockOpenAI(t, {
      content: groundedContent([
        { text: 'Legal cases abroad can last a long time.', evidenceIds: ['govuk-limits-of-uk-government-power'] },
        { text: 'A case manager may share hearing dates.', evidenceIds: ['govuk-court-proceedings-abroad'] },
      ]),
    });
    const { json } = await askChat(SAME_PUBLISHER_QUESTION);

    assert.deepEqual(
      json.sources.map((source) => [source.citation, source.title, source.sourceName, source.sourceUrl]),
      [
        [1, 'Limits of UK government power abroad', 'GOV.UK', GOV_UK_GUIDE_URL],
        [2, 'Court and legal proceedings abroad', 'GOV.UK', GOV_UK_GUIDE_URL],
      ]
    );
  });

  test('citation numbers and source metadata come from the server, never the model', async (t) => {
    mockOpenAI(t, {
      content: groundedContent([{ text: 'Guidance about lawyers.', evidenceIds: ['govuk-lawyers-abroad'] }]),
    });
    const { json } = await askChat(CHARITY_QUESTION);

    assert.equal(json.answer, 'Guidance about lawyers. [1]');
    assert.deepEqual(json.sources, [
      { citation: 1, title: 'Lawyers abroad', sourceName: 'GOV.UK', sourceUrl: GOV_UK_GUIDE_URL, category: 'lawyers' },
    ]);
  });
});

describe('untrustworthy model output falls back safely', () => {
  test('an invented evidence ID', async (t) => {
    const [, reason] = await expectSafeFallback(
      t,
      groundedContent([{ text: 'Invented.', evidenceIds: ['govuk-made-up-source'] }])
    );
    assert.equal(reason, 'unselected-evidence-id');
  });

  test('a real corpus ID that retrieval did not select', async (t) => {
    await expectSafeFallback(t, groundedContent([{ text: 'Contact the charity.', evidenceIds: ['ma-contact-support'] }]));
  });

  test('empty evidence IDs', async (t) => {
    await expectSafeFallback(t, groundedContent([{ text: 'Uncited claim.', evidenceIds: [] }]));
  });

  test('empty text', async (t) => {
    await expectSafeFallback(t, groundedContent([{ text: ' ', evidenceIds: ['govuk-lawyers-abroad'] }]));
  });

  test('malformed JSON', async (t) => {
    await expectSafeFallback(t, '{"status": "answered", "segments": [');
  });

  test('unexpected output shape, including model-supplied source metadata', async (t) => {
    await expectSafeFallback(
      t,
      JSON.stringify({
        status: 'answered',
        segments: [{ text: 'A.', evidenceIds: ['govuk-lawyers-abroad'], sourceUrl: 'https://evil.example/' }],
      })
    );
  });

  test('status "unsupported"', async (t) => {
    const [, reason] = await expectSafeFallback(t, JSON.stringify({ status: 'unsupported', segments: [] }));
    assert.equal(reason, 'unsupported');
  });

  test('a refusal', async (t) => {
    const [, reason] = await expectSafeFallback(t, null, { refusal: 'I cannot help with that.' });
    assert.equal(reason, 'refusal');
  });

  test('model-written citation numbers', async (t) => {
    await expectSafeFallback(t, groundedContent([{ text: 'Appoint a lawyer [1].', evidenceIds: ['govuk-lawyers-abroad'] }]));
  });
});

describe('fallback and emergency paths never call OpenAI', () => {
  test('retrieval fallback and emergency responses are unchanged and make no request', async (t) => {
    const calls = mockOpenAI(t);
    const fallback = await askChat('What is the weather like in Spain?');
    const emergency = await askChat('I am in immediate danger');

    assert.equal(calls.length, 0);
    assert.ok(fallback.json.answer.startsWith(FALLBACK_PREFIX));
    assert.equal(fallback.json.answer, FALLBACK_ANSWER);
    assert.ok(emergency.json.answer.startsWith('If there is immediate danger'));
  });
});
