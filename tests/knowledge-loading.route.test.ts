// Route-level tests for knowledge-base loading and its position in the request
// pipeline: request validation → emergency detection → knowledge loading.
// Runtime knowledge-base validation was intentionally introduced in Phase 2A.
import assert from 'node:assert/strict';
import { promises as fsPromises } from 'node:fs';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import { KnowledgeBaseValidationError } from '@/lib/knowledge-schema';
import { askChat, askChatExpectingError, EMERGENCY_PREFIX, mockOpenAI } from './helpers/chat-route';

const GENERIC_ERROR =
  'Sorry, the assistant could not respond right now. Please try again, or contact official support routes if the matter is urgent.';

// Replaces fs.promises.readFile for one test so the route sees the given knowledge-base contents.
function mockKnowledgeBaseFile(t: TestContext, contents: string) {
  return t.mock.method(fsPromises, 'readFile', async (filePath: unknown) => {
    assert.match(String(filePath), /data[\\/]knowledge-base\.json$/);
    return contents;
  });
}

function captureErrors(t: TestContext) {
  return t.mock.method(console, 'error', () => {});
}

async function expectGenericValidationFailure(
  t: TestContext,
  contents: string,
  expectedMessage: string
) {
  const readFile = mockKnowledgeBaseFile(t, contents);
  const errors = captureErrors(t);
  const openAICalls = mockOpenAI(t);

  const { status, json } = await askChatExpectingError({ message: 'lawyers' });

  assert.equal(status, 500);
  assert.deepEqual(json, { error: GENERIC_ERROR });
  assert.equal(readFile.mock.callCount(), 1);
  assert.equal(openAICalls.length, 0);

  assert.equal(errors.mock.callCount(), 1);
  const [label, error] = errors.mock.calls[0].arguments;
  assert.equal(label, '/api/chat failed:');
  assert.ok(error instanceof KnowledgeBaseValidationError);
  assert.equal(error.message, expectedMessage);

  // Validation details stay in the server log, never in the response.
  const responseText = JSON.stringify(json);
  assert.ok(!responseText.includes(expectedMessage));
  assert.ok(!responseText.includes('KnowledgeBase'));
  assert.ok(!responseText.includes('Entry'));
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

describe('emergency path independence', () => {
  test('emergency request succeeds without reading the knowledge base, even when reading would fail', async (t) => {
    const readFile = t.mock.method(fsPromises, 'readFile', async () => {
      throw new Error('knowledge base unavailable');
    });
    const openAICalls = mockOpenAI(t);

    const { status, json } = await askChat('I am in immediate danger');

    assert.equal(status, 200);
    assert.ok(json.answer.startsWith(EMERGENCY_PREFIX));
    assert.equal(json.fallbackUsed, true);
    assert.equal(readFile.mock.callCount(), 0);
    assert.equal(openAICalls.length, 0);
  });
});

describe('knowledge-base validation failures', () => {
  test('empty knowledge-base array returns the generic 500 and logs a validation error', async (t) => {
    await expectGenericValidationFailure(t, '[]', 'Knowledge base must not be empty');
  });

  test('entry missing a required field returns the generic 500 and logs a validation error', async (t) => {
    const entryWithoutContent = {
      id: 'govuk-lawyers-abroad',
      title: 'Lawyers abroad',
      sourceName: 'GOV.UK',
      sourceUrl: 'https://www.gov.uk/example',
      category: 'lawyers',
    };

    await expectGenericValidationFailure(
      t,
      JSON.stringify([entryWithoutContent]),
      'Entry 0 has a missing or empty "content"'
    );
  });
});
