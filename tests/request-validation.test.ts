// Request-body validation and the message length limit (Phase 3A). Written before the
// request parsing was hardened; they describe the required behaviour.
import assert from 'node:assert/strict';
import { promises as fsPromises } from 'node:fs';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import { MAX_MESSAGE_CHARACTERS } from '@/lib/chat-request';
import { mockOpenAI, postChat } from './helpers/chat-route';

const INVALID_REQUEST = { error: 'Please enter a question.' };

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

// Records OpenAI calls and knowledge-base reads; neither should happen for a rejected request.
function watch(t: TestContext) {
  const openAI = mockOpenAI(t);
  const original = fsPromises.readFile.bind(fsPromises);
  const readFile = t.mock.method(fsPromises, 'readFile', original);
  const errors = t.mock.method(console, 'error', () => {});
  return { openAI, readFile, errors };
}

function assertNothingDone(watched: ReturnType<typeof watch>) {
  assert.equal(watched.openAI.length, 0, 'OpenAI was called');
  assert.equal(watched.readFile.mock.callCount(), 0, 'the knowledge base was read');
  assert.equal(watched.errors.mock.callCount(), 0, 'a server error was logged');
}

describe('request body validation', () => {
  for (const [label, body, raw] of [
    ['invalid JSON', '{not json', true],
    ['JSON null', 'null', true],
    ['JSON array', [], false],
    ['JSON string', 'lawyers', false],
    ['JSON number', '42', true],
    ['missing message', {}, false],
    ['non-string message', { message: 42 }, false],
    ['null message', { message: null }, false],
    ['blank message', { message: '   ' }, false],
  ] as const) {
    test(`${label} returns 400 with the generic message and does no work`, async (t) => {
      const watched = watch(t);
      const { status, json } = await postChat(body, { raw });

      assert.equal(status, 400);
      assert.deepEqual(json, INVALID_REQUEST);
      assertNothingDone(watched);
    });
  }
});

describe('message length limit', () => {
  test('the limit is 4,000 characters', () => {
    assert.equal(MAX_MESSAGE_CHARACTERS, 4000);
  });

  // "lawyers" retrieves approved evidence, so an accepted message reaches the (mocked) model.
  function messageOfLength(length: number) {
    return `lawyers ${'x'.repeat(length - 'lawyers '.length)}`;
  }

  for (const length of [MAX_MESSAGE_CHARACTERS - 1, MAX_MESSAGE_CHARACTERS]) {
    test(`${length} characters is accepted`, async (t) => {
      mockOpenAI(t);
      t.mock.method(console, 'warn', () => {});
      const { status } = await postChat({ message: messageOfLength(length) });
      assert.equal(status, 200);
    });
  }

  test(`${MAX_MESSAGE_CHARACTERS + 1} characters returns 400 without retrieval or OpenAI`, async (t) => {
    const watched = watch(t);
    const { status, json } = await postChat({ message: messageOfLength(MAX_MESSAGE_CHARACTERS + 1) });

    assert.equal(status, 400);
    assert.deepEqual(json, { error: 'Please shorten your question to 4,000 characters or fewer.' });
    assertNothingDone(watched);
  });

  test('surrounding whitespace does not count towards the limit', async (t) => {
    mockOpenAI(t);
    const { status } = await postChat({ message: `   ${messageOfLength(MAX_MESSAGE_CHARACTERS)}   ` });
    assert.equal(status, 200);
  });

  test('the limit counts characters, not UTF-16 code units', async (t) => {
    mockOpenAI(t);
    const emoji = '🙏';
    const message = `lawyers ${emoji.repeat(MAX_MESSAGE_CHARACTERS - 'lawyers '.length)}`;
    assert.ok(message.length > MAX_MESSAGE_CHARACTERS);
    const { status } = await postChat({ message });
    assert.equal(status, 200);
  });
});
