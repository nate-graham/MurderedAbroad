// Direct unit tests for lib/generation.ts.
import assert from 'node:assert/strict';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import {
  buildChatCompletionRequest,
  buildContext,
  DEFAULT_OPENAI_MODEL,
  generateAnswer,
  OPENAI_CHAT_COMPLETIONS_URL,
  SYSTEM_PROMPT,
} from '@/lib/generation';
import type { KnowledgeEntry } from '@/lib/knowledge-schema';

const first: KnowledgeEntry = {
  id: 'first',
  title: 'First',
  sourceName: 'GOV.UK',
  sourceUrl: 'https://www.gov.uk/first',
  category: 'one',
  content: 'First content.',
};

const second: KnowledgeEntry = {
  id: 'second',
  title: 'Second',
  sourceName: 'Murdered Abroad Charity',
  sourceUrl: 'https://www.murdered-abroad.org.uk/second',
  category: 'two',
  content: 'Second content.',
};

function mockFetch(t: TestContext, response: () => Response) {
  return t.mock.method(globalThis, 'fetch', async () => response());
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

describe('buildContext', () => {
  test('formats numbered context blocks separated by a blank line', () => {
    assert.equal(
      buildContext([first, second]),
      'Context 1\nTitle: First\nCategory: one\nSource name: GOV.UK\nSource URL: https://www.gov.uk/first\nContent: First content.' +
        '\n\n' +
        'Context 2\nTitle: Second\nCategory: two\nSource name: Murdered Abroad Charity\nSource URL: https://www.murdered-abroad.org.uk/second\nContent: Second content.'
    );
  });

  test('returns an empty string for no matches', () => {
    assert.equal(buildContext([]), '');
  });
});

describe('buildChatCompletionRequest', () => {
  test('builds a single-turn request with fixed parameters', () => {
    assert.deepEqual(buildChatCompletionRequest({ message: 'Question?', matches: [first], model: 'model-x' }), {
      model: 'model-x',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `User question:\nQuestion?\n\nApproved source context:\n${buildContext([first])}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 550,
    });
  });
});

describe('generateAnswer', () => {
  test('posts to Chat Completions with the default model and returns the trimmed answer', async (t) => {
    const fetchMock = mockFetch(
      t,
      () => new Response(JSON.stringify({ choices: [{ message: { content: '  Answer \n' } }] }))
    );

    assert.equal(await generateAnswer({ message: 'Question?', matches: [first] }), 'Answer');
    const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, OPENAI_CHAT_COMPLETIONS_URL);
    assert.equal(JSON.parse(String(init.body)).model, DEFAULT_OPENAI_MODEL);
  });

  test('uses OPENAI_MODEL when set', async (t) => {
    process.env.OPENAI_MODEL = 'model-y';
    const fetchMock = mockFetch(t, () => new Response(JSON.stringify({ choices: [{ message: { content: 'A' } }] })));

    await generateAnswer({ message: 'Question?', matches: [first] });
    const [, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(JSON.parse(String(init.body)).model, 'model-y');
  });

  test('throws without calling OpenAI when the API key is missing', async (t) => {
    t.mock.method(console, 'warn', () => {});
    delete process.env.OPENAI_API_KEY;
    const fetchMock = mockFetch(t, () => new Response('{}'));

    await assert.rejects(generateAnswer({ message: 'Question?', matches: [first] }), {
      message: 'Missing OpenAI API key',
    });
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test('throws when OpenAI returns an error status', async (t) => {
    t.mock.method(console, 'error', () => {});
    mockFetch(t, () => new Response('bad', { status: 500 }));

    await assert.rejects(generateAnswer({ message: 'Question?', matches: [first] }), {
      message: 'OpenAI API request failed',
    });
  });

  test('throws when the response has no choices', async (t) => {
    mockFetch(t, () => new Response(JSON.stringify({})));

    await assert.rejects(generateAnswer({ message: 'Question?', matches: [first] }), {
      message: 'OpenAI returned an empty answer',
    });
  });
});
