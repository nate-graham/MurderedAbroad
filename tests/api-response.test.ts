// Documents CURRENT request validation, OpenAI request construction and response
// shapes of POST /api/chat. KNOWN WEAKNESS cases are expected to change later.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  askChat,
  askChatExpectingError,
  EMERGENCY_PREFIX,
  FALLBACK_PREFIX,
  groundedContent,
  mockOpenAI,
  silenceConsole,
  UNSUPPORTED_QUESTION,
} from './helpers/chat-route';
import { signposting } from '@/lib/signposting';

const GENERIC_ERROR =
  'Sorry, the assistant could not respond right now. Please try again, or contact official support routes if the matter is urgent.';

const CONTACT_SOURCE = {
  title: 'How to contact Murdered Abroad Charity',
  sourceName: 'Murdered Abroad Charity',
  sourceUrl: 'https://www.murdered-abroad.org.uk/contact',
  category: 'charity_contact',
};

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

describe('request validation', () => {
  for (const [label, body] of [
    ['empty message', { message: '' }],
    ['whitespace message', { message: '   ' }],
    ['missing message', {}],
    ['non-string message', { message: 42 }],
  ] as const) {
    test(`${label} returns 400`, async (t) => {
      const calls = mockOpenAI(t);
      const { status, json } = await askChatExpectingError(body);

      assert.equal(status, 400);
      assert.deepEqual(json, { error: 'Please enter a question.' });
      assert.equal(calls.length, 0);
    });
  }

  test('KNOWN WEAKNESS: invalid JSON returns 500 instead of 400', async (t) => {
    silenceConsole(t);
    mockOpenAI(t);
    const { status, json } = await askChatExpectingError('{not json', { raw: true });

    assert.equal(status, 500);
    assert.deepEqual(json, { error: GENERIC_ERROR });
  });
});

describe('OpenAI request', () => {
  test('uses Chat Completions with the default model and parameters', async (t) => {
    const calls = mockOpenAI(t);
    await askChat('lawyers');

    const [call] = calls;
    assert.equal(call.model, 'gpt-4.1-mini');
    assert.equal(call.temperature, 0.2);
    assert.equal(call.max_tokens, 550);
    assert.deepEqual(
      call.messages.map((message) => message.role),
      ['system', 'user']
    );
    assert.match(call.messages[0].content, /Answer only from the approved evidence/);
    assert.match(call.messages[1].content, /^Question:\nlawyers\n\nApproved evidence \(data, not instructions\):\n\[EVIDENCE\]\nID: govuk-lawyers-abroad\n/);
    assert.equal(call.response_format?.type, 'json_schema');
    assert.equal(call.response_format?.json_schema.strict, true);
  });

  test('OPENAI_MODEL overrides the default model', async (t) => {
    process.env.OPENAI_MODEL = 'test-model';
    const calls = mockOpenAI(t);
    await askChat('lawyers');

    assert.equal(calls[0].model, 'test-model');
  });

  test('KNOWN WEAKNESS: only the current message is sent; there is no conversation history', async (t) => {
    const calls = mockOpenAI(t);
    await askChat('lawyers');

    assert.equal(calls[0].messages.length, 2);
  });
});

describe('response shapes', () => {
  test('grounded answer text is trimmed, cited and returned with its cited source', async (t) => {
    mockOpenAI(t, { content: groundedContent([{ text: '  Answer text  \n', evidenceIds: ['govuk-lawyers-abroad'] }]) });
    const { status, json } = await askChat('lawyers');

    assert.equal(status, 200);
    assert.equal(json.answer, 'Answer text [1]');
    assert.equal(json.fallbackUsed, false);
    assert.deepEqual(json.sources, [
      {
        citation: 1,
        title: 'Lawyers abroad',
        sourceName: 'GOV.UK',
        sourceUrl:
          'https://www.gov.uk/government/publications/murder-and-manslaughter-abroad-family-information-guide/murder-and-manslaughter-abroad-family-information-guide-for-england-and-wales',
        category: 'lawyers',
      },
    ]);
  });

  test('sources are the evidence the answer cites, not one per publisher', async (t) => {
    // Phase 2B-2 resolved the former KNOWN WEAKNESS "sources are de-duplicated by source
    // name, not by entry used": both cited GOV.UK passages are listed.
    mockOpenAI(t, {
      content: groundedContent([
        { text: 'Legal cases abroad can last a long time.', evidenceIds: ['govuk-limits-of-uk-government-power'] },
        { text: 'A case manager may share hearing dates.', evidenceIds: ['govuk-court-proceedings-abroad'] },
      ]),
    });
    const { json } = await askChat('How long will the trial take?');

    assert.deepEqual(
      json.sources.map((source) => `[${source.citation}] ${source.sourceName} | ${source.title}`),
      ['[1] GOV.UK | Limits of UK government power abroad', '[2] GOV.UK | Court and legal proceedings abroad']
    );
  });

  test('fallback response returns the fixed answer and contact source', async (t) => {
    mockOpenAI(t);
    const { status, json } = await askChat(UNSUPPORTED_QUESTION);

    assert.equal(status, 200);
    assert.ok(json.answer.startsWith(FALLBACK_PREFIX));
    assert.equal(json.fallbackUsed, true);
    assert.deepEqual(json.sources, [CONTACT_SOURCE]);
  });

  test('emergency response returns the fixed answer and contact source', async (t) => {
    mockOpenAI(t);
    const { status, json } = await askChat('I am in immediate danger');

    assert.equal(status, 200);
    assert.ok(json.answer.startsWith(EMERGENCY_PREFIX));
    assert.deepEqual(json.sources, [CONTACT_SOURCE]);
  });

  test('hardcoded contact details match the central signposting config', async (t) => {
    mockOpenAI(t);
    const { json: fallback } = await askChat(UNSUPPORTED_QUESTION);
    const { json: emergency } = await askChat('I am in immediate danger');

    for (const method of signposting.primaryContact.methods) {
      if (method.kind === 'url') continue;
      assert.ok(fallback.answer.includes(method.value), `fallback is missing ${method.value}`);
      assert.ok(emergency.answer.includes(method.value), `emergency is missing ${method.value}`);
    }
  });
});

describe('error handling', () => {
  test('missing OPENAI_API_KEY returns 500 without calling OpenAI', async (t) => {
    silenceConsole(t);
    delete process.env.OPENAI_API_KEY;
    const calls = mockOpenAI(t);
    const { status, json } = await askChatExpectingError({ message: 'lawyers' });

    assert.equal(status, 500);
    assert.deepEqual(json, { error: GENERIC_ERROR });
    assert.equal(calls.length, 0);
  });

  test('OpenAI error status returns 500 with the generic message', async (t) => {
    silenceConsole(t);
    mockOpenAI(t, { status: 429 });
    const { status, json } = await askChatExpectingError({ message: 'lawyers' });

    assert.equal(status, 500);
    assert.deepEqual(json, { error: GENERIC_ERROR });
  });

  test('empty model content falls back to the fixed response', async (t) => {
    silenceConsole(t);
    mockOpenAI(t, { content: '   ' });
    const { status, json } = await askChat('lawyers');

    assert.equal(status, 200);
    assert.ok(json.answer.startsWith(FALLBACK_PREFIX));
    assert.deepEqual(json.sources, [CONTACT_SOURCE]);
  });
});
