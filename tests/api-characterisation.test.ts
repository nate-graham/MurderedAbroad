// Characterisation tests pinning the exact current output of POST /api/chat.
// Written against the pre-refactor route (Phase 2A) so the module extraction can
// be proven byte-for-byte behaviour-preserving. KNOWN WEAKNESS cases are expected
// to change in a later phase.
import assert from 'node:assert/strict';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import { askChat, askChatExpectingError, postChat, silenceConsole } from './helpers/chat-route';

const FALLBACK_ANSWER =
  'I could not find a clear answer in the approved source material.\n\nThe safest next step is to contact Murdered Abroad Charity directly: support@murdered-abroad.org.uk or helpline 0845 123 2384.\n\nYou can also contact the nearest British Embassy, High Commission or Consulate, or local police/authorities in the country involved. If there is immediate danger, contact emergency services immediately.';

const EMERGENCY_ANSWER =
  'If there is immediate danger, contact emergency services immediately.\n\n1. Contact local emergency services now.\n2. Contact local police or authorities in the country involved.\n3. Once the immediate danger is being handled, contact Murdered Abroad Charity at support@murdered-abroad.org.uk or helpline 0845 123 2384, or contact the nearest British Embassy, High Commission or Consulate for support routes.\n\nIf you are unsure who to contact, contact emergency services first if anyone is at immediate risk.';

const CONTACT_SOURCE = {
  title: 'How to contact Murdered Abroad Charity',
  sourceName: 'Murdered Abroad Charity',
  sourceUrl: 'https://www.murdered-abroad.org.uk/contact',
  category: 'charity_contact',
};

const SYSTEM_PROMPT = `You are a support assistant for families affected by murder or manslaughter abroad. You may only answer using the approved source context provided to you. If the answer is not clearly available in the approved context, say you do not have enough information and recommend contacting Murdered Abroad Charity, the nearest British Embassy, High Commission or Consulate, local police/authorities, or emergency services if there is immediate danger. Do not use general knowledge. Do not invent details. Do not give legal advice.

Response format:
- Start with a direct answer.
- Then give 2-4 practical next steps.
- End with who to contact if unsure.

Only cite or mention facts present in the approved source context. If approved context includes Murdered Abroad Charity contact details and the user needs direct help or the answer is uncertain, include those contact details.`;

const GOV_UK_GUIDE_URL =
  'https://www.gov.uk/government/publications/murder-and-manslaughter-abroad-family-information-guide/murder-and-manslaughter-abroad-family-information-guide-for-england-and-wales';

type CapturedFetch = { url: string; init: RequestInit | undefined };

function captureFetch(t: TestContext, response: () => Response) {
  const calls: CapturedFetch[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response();
  });
  return calls;
}

function okCompletion(content: string) {
  return () => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

describe('exact fixed responses', () => {
  test('fallback response is byte-identical', async (t) => {
    captureFetch(t, okCompletion('unused'));
    const { status, json } = await askChat('lawyer');

    assert.equal(status, 200);
    assert.deepEqual(json, { answer: FALLBACK_ANSWER, sources: [CONTACT_SOURCE], fallbackUsed: true });
  });

  test('emergency response is byte-identical', async (t) => {
    captureFetch(t, okCompletion('unused'));
    const { status, json } = await askChat('I am in immediate danger');

    assert.equal(status, 200);
    assert.deepEqual(json, { answer: EMERGENCY_ANSWER, sources: [CONTACT_SOURCE], fallbackUsed: true });
  });

  test('success response JSON has keys in order answer, sources, fallbackUsed', async (t) => {
    captureFetch(t, okCompletion('Answer'));
    const response = await postChat({ message: 'lawyers' });

    assert.deepEqual(Object.keys(response.json), ['answer', 'sources', 'fallbackUsed']);
  });
});

describe('exact OpenAI request', () => {
  test('endpoint, headers and full request body', async (t) => {
    const calls = captureFetch(t, okCompletion('Answer'));
    await askChat('lawyers');

    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(init?.headers, { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            'User question:\nlawyers\n\nApproved source context:\n' +
            `Context 1\nTitle: Lawyers abroad\nCategory: lawyers\nSource name: GOV.UK\nSource URL: ${GOV_UK_GUIDE_URL}\nContent: GOV.UK says investigations and legal proceedings abroad can take an unknown amount of time. Families could consider appointing a local lawyer to support them through the legal process. The FCDO case manager can help explain what to expect and provide a list of local lawyers.` +
            '\n\n' +
            `Context 2\nTitle: Ongoing FCDO and consular support\nCategory: embassy_consulate\nSource name: GOV.UK\nSource URL: ${GOV_UK_GUIDE_URL}\nContent: GOV.UK says ongoing FCDO support may include advice on local customs and what to expect, help arranging airport assistance, the option to meet a consular officer at the nearest British embassy or consulate, help arranging a meeting with local police or investigating authorities, lists of English-speaking lawyers and translators, support attending some overseas trial dates, and advice on media interest.`,
        },
      ],
      temperature: 0.2,
      max_tokens: 550,
    });
  });

  test('empty OPENAI_MODEL falls back to the default model', async (t) => {
    process.env.OPENAI_MODEL = '';
    const calls = captureFetch(t, okCompletion('Answer'));
    await askChat('lawyers');

    assert.equal(JSON.parse(String(calls[0].init?.body)).model, 'gpt-4.1-mini');
  });

  test('user message is trimmed before being sent', async (t) => {
    const calls = captureFetch(t, okCompletion('Answer'));
    await askChat('   lawyers   ');

    const body = JSON.parse(String(calls[0].init?.body));
    assert.ok(body.messages[1].content.startsWith('User question:\nlawyers\n\n'));
  });
});

describe('ordering of checks', () => {
  test('missing API key does not affect fallback questions', async (t) => {
    delete process.env.OPENAI_API_KEY;
    const calls = captureFetch(t, okCompletion('unused'));
    const { status, json } = await askChat('lawyer');

    assert.equal(status, 200);
    assert.equal(json.answer, FALLBACK_ANSWER);
    assert.equal(calls.length, 0);
  });

  test('missing API key does not affect emergency questions', async (t) => {
    delete process.env.OPENAI_API_KEY;
    const calls = captureFetch(t, okCompletion('unused'));
    const { status, json } = await askChat('I am in immediate danger');

    assert.equal(status, 200);
    assert.equal(json.answer, EMERGENCY_ANSWER);
    assert.equal(calls.length, 0);
  });

  test('emergency check runs before retrieval even when the message matches knowledge entries', async (t) => {
    const calls = captureFetch(t, okCompletion('unused'));
    const { json } = await askChat('emergency lawyers repatriation');

    assert.equal(json.answer, EMERGENCY_ANSWER);
    assert.equal(calls.length, 0);
  });
});

describe('request body edge cases', () => {
  test('JSON array body returns 400', async (t) => {
    captureFetch(t, okCompletion('unused'));
    const { status } = await askChatExpectingError([]);
    assert.equal(status, 400);
  });

  test('JSON string body returns 400', async (t) => {
    captureFetch(t, okCompletion('unused'));
    const { status } = await askChatExpectingError('lawyers');
    assert.equal(status, 400);
  });

  test('KNOWN WEAKNESS: JSON null body returns 500 instead of 400', async (t) => {
    silenceConsole(t);
    captureFetch(t, okCompletion('unused'));
    const { status } = await askChatExpectingError('null', { raw: true });
    assert.equal(status, 500);
  });
});

describe('error logging', () => {
  test('OpenAI failure logs status and body, then the route failure', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    captureFetch(t, () => new Response('upstream body', { status: 503 }));
    const { status } = await askChatExpectingError({ message: 'lawyers' });

    assert.equal(status, 500);
    assert.equal(errors.mock.callCount(), 2);
    assert.deepEqual(errors.mock.calls[0].arguments, ['OpenAI API request failed:', 503, 'upstream body']);
    assert.equal(errors.mock.calls[1].arguments[0], '/api/chat failed:');
    assert.equal((errors.mock.calls[1].arguments[1] as Error).message, 'OpenAI API request failed');
  });

  test('missing API key warns, then logs the route failure', async (t) => {
    const warnings = t.mock.method(console, 'warn', () => {});
    const errors = t.mock.method(console, 'error', () => {});
    delete process.env.OPENAI_API_KEY;
    captureFetch(t, okCompletion('unused'));
    await askChatExpectingError({ message: 'lawyers' });

    assert.deepEqual(warnings.mock.calls[0].arguments, [
      'Missing OPENAI_API_KEY. Add it to .env.local for /api/chat.',
    ]);
    assert.equal((errors.mock.calls[0].arguments[1] as Error).message, 'Missing OpenAI API key');
  });

  test('empty model answer logs an empty-answer route failure', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    captureFetch(t, okCompletion('  '));
    await askChatExpectingError({ message: 'lawyers' });

    assert.equal((errors.mock.calls[0].arguments[1] as Error).message, 'OpenAI returned an empty answer');
  });
});
