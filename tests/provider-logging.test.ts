// OpenAI error responses must be logged minimally (Phase 3A). Written before the
// provider-error logging was hardened.
import assert from 'node:assert/strict';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import { askChatExpectingError } from './helpers/chat-route';

const GENERIC_ERROR =
  'Sorry, the assistant could not respond right now. Please try again, or contact official support routes if the matter is urgent.';

// A supported question (so the request reaches the mocked provider), and synthetic
// markers standing in for model output and evidence an upstream error body might echo.
const QUESTION = 'Must I appoint a solicitor?';
const SECRET_QUESTION_MARKER = 'appoint a solicitor';
const SECRET_MODEL_MARKER = 'MODEL-OUTPUT-MARKER';
const SECRET_EVIDENCE_MARKER = 'EVIDENCE-CONTENT-MARKER';

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test-SECRET-KEY-MARKER';
  delete process.env.OPENAI_MODEL;
});

function mockProviderError(t: TestContext, status: number, body: string) {
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { status }));
}

async function loggedFor(t: TestContext, status: number, body: string) {
  const errors = t.mock.method(console, 'error', () => {});
  const warnings = t.mock.method(console, 'warn', () => {});
  mockProviderError(t, status, body);

  const response = await askChatExpectingError({ message: QUESTION });
  assert.equal(response.status, 500);
  assert.deepEqual(response.json, { error: GENERIC_ERROR });

  const logged = JSON.stringify([...errors.mock.calls, ...warnings.mock.calls].map((call) => call.arguments.map(String)));
  for (const marker of [SECRET_QUESTION_MARKER, SECRET_MODEL_MARKER, SECRET_EVIDENCE_MARKER, 'SECRET-KEY-MARKER']) {
    assert.ok(!logged.includes(marker), `logged ${marker}`);
  }
  return errors.mock.calls[0].arguments;
}

describe('provider error logging', () => {
  test('logs only the status and a safe provider error code', async (t) => {
    const body = JSON.stringify({
      error: {
        message: `Quota exceeded for ${SECRET_QUESTION_MARKER} ${SECRET_MODEL_MARKER} ${SECRET_EVIDENCE_MARKER}`,
        type: 'insufficient_quota',
        code: 'insufficient_quota',
        param: SECRET_EVIDENCE_MARKER,
      },
    });
    assert.deepEqual(await loggedFor(t, 429, body), ['OpenAI API request failed:', 429, 'insufficient_quota']);
  });

  test('an unsafe or missing error code is not logged', async (t) => {
    const body = JSON.stringify({ error: { message: SECRET_MODEL_MARKER, code: `bad code ${SECRET_QUESTION_MARKER}` } });
    assert.deepEqual(await loggedFor(t, 400, body), ['OpenAI API request failed:', 400, 'unknown']);
  });

  for (const code of ['rate_limit_exceeded', 'invalid_api_key', 'model_not_found', 'context_length_exceeded']) {
    test(`recognised code "${code}" is logged`, async (t) => {
      const body = JSON.stringify({ error: { message: SECRET_MODEL_MARKER, code } });
      assert.deepEqual(await loggedFor(t, 400, body), ['OpenAI API request failed:', 400, code]);
    });
  }

  // Identifier-shaped but unrecognised codes could carry sensitive values.
  for (const code of ['sk-test-SECRET-KEY-MARKER', 'MODEL-OUTPUT-MARKER', 'EVIDENCE-CONTENT-MARKER', 'some_new_code']) {
    test(`unrecognised code "${code}" is logged as unknown`, async (t) => {
      const body = JSON.stringify({ error: { message: 'x', code } });
      const logged = await loggedFor(t, 400, body);
      assert.deepEqual(logged, ['OpenAI API request failed:', 400, 'unknown']);
      assert.ok(!JSON.stringify(logged).includes(code));
    });
  }

  test('a non-JSON error body is not logged', async (t) => {
    assert.deepEqual(await loggedFor(t, 502, `<html>${SECRET_QUESTION_MARKER}</html>`), [
      'OpenAI API request failed:',
      502,
      'unknown',
    ]);
  });
});
