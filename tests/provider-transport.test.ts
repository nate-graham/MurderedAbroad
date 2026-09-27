// OpenAI transport hardening (Phase 3B): timeout, bounded response bodies and safe
// failure logging. Written before the implementation. Fetch is always mocked.
import assert from 'node:assert/strict';
import { beforeEach, describe, test, type TestContext } from 'node:test';
import { MAX_PROVIDER_RESPONSE_BYTES, PROVIDER_TIMEOUT_MS } from '@/lib/generation';
import { askChat, askChatExpectingError, groundedContent } from './helpers/chat-route';

const GENERIC_ERROR =
  'Sorry, the assistant could not respond right now. Please try again, or contact official support routes if the matter is urgent.';
const QUESTION = 'Must I appoint a solicitor?';
const MARKERS = ['appoint a solicitor', 'MODEL-OUTPUT-MARKER', 'EVIDENCE-CONTENT-MARKER', 'SECRET-KEY-MARKER'];

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test-SECRET-KEY-MARKER';
  delete process.env.OPENAI_MODEL;
  delete process.env.CHAT_GENERATION_DISABLED;
});

function validCompletion(padding = '') {
  const content = groundedContent([{ text: `You may appoint a lawyer.${padding}`, evidenceIds: ['govuk-lawyers-abroad'] }]);
  return JSON.stringify({ choices: [{ message: { content, refusal: null }, finish_reason: 'stop' }] });
}

function captureLogs(t: TestContext) {
  const errors = t.mock.method(console, 'error', () => {});
  const warnings = t.mock.method(console, 'warn', () => {});
  return () => {
    const logged = JSON.stringify([...errors.mock.calls, ...warnings.mock.calls].map((call) => call.arguments.map(String)));
    for (const marker of MARKERS) assert.ok(!logged.includes(marker), `logged ${marker}`);
    return errors.mock.calls.map((call) => call.arguments);
  };
}

async function expectGenericFailure() {
  const { status, json } = await askChatExpectingError({ message: QUESTION });
  assert.equal(status, 500);
  assert.deepEqual(json, { error: GENERIC_ERROR });
}

describe('provider timeout', () => {
  test('the timeout is 20 seconds', () => {
    assert.equal(PROVIDER_TIMEOUT_MS, 20_000);
  });

  test('a provider that never responds is aborted and gives the generic failure', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const logs = captureLogs(t);
    let signal: AbortSignal | undefined;
    const { promise: fetchCalled, resolve: onFetch } = Promise.withResolvers<void>();
    t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      onFetch();
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted with MODEL-OUTPUT-MARKER', 'AbortError')));
      });
    });

    const pending = expectGenericFailure();
    // The timer is started before fetch, so it exists once fetch has been called.
    await fetchCalled;
    t.mock.timers.tick(PROVIDER_TIMEOUT_MS - 1);
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(1);
    await pending;

    assert.equal(signal?.aborted, true);
    assert.deepEqual(logs()[0], ['OpenAI API request failed:', 'timeout']);
  });

  test('a provider that stalls while sending the body is also aborted', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const logs = captureLogs(t);
    const { promise: fetchCalled, resolve: onFetch } = Promise.withResolvers<void>();
    t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      onFetch();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"choices":'));
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(body, { status: 200 });
    });

    const pending = expectGenericFailure();
    // The timer is started before fetch, so it exists once fetch has been called.
    await fetchCalled;
    t.mock.timers.tick(PROVIDER_TIMEOUT_MS - 1);
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(1);
    await pending;
    assert.deepEqual(logs()[0], ['OpenAI API request failed:', 'timeout']);
  });

  test('a response before the timeout is used and the timer is cleared', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal: AbortSignal | undefined;
    t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response(validCompletion(), { status: 200 });
    });

    const { json } = await askChat(QUESTION);
    assert.equal(json.fallbackUsed, false);
    assert.equal(json.answer, 'You may appoint a lawyer. [1]');

    // No timer is left to abort anything after a successful response.
    t.mock.timers.tick(PROVIDER_TIMEOUT_MS * 2);
    assert.equal(signal?.aborted, false);
  });
});

describe('bounded provider responses', () => {
  test('the bound is 64 KiB', () => {
    assert.equal(MAX_PROVIDER_RESPONSE_BYTES, 64 * 1024);
  });

  test('a normal structured response is accepted', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(validCompletion(), { status: 200 }));
    const { json } = await askChat(QUESTION);
    assert.equal(json.fallbackUsed, false);
  });

  test('a response of exactly the bound is accepted', async (t) => {
    const base = validCompletion();
    const padding = ' '.repeat(MAX_PROVIDER_RESPONSE_BYTES - base.length);
    const exact = base.replace('{"choices"', `{${padding}"choices"`);
    assert.equal(new TextEncoder().encode(exact).length, MAX_PROVIDER_RESPONSE_BYTES);
    t.mock.method(globalThis, 'fetch', async () => new Response(exact, { status: 200 }));
    const { json } = await askChat(QUESTION);
    assert.equal(json.fallbackUsed, false);
  });

  test('an oversized success response is rejected before grounding and gives the generic failure', async (t) => {
    const logs = captureLogs(t);
    const oversized = validCompletion(` MODEL-OUTPUT-MARKER ${'x'.repeat(MAX_PROVIDER_RESPONSE_BYTES)}`);
    t.mock.method(globalThis, 'fetch', async () => new Response(oversized, { status: 200 }));
    await expectGenericFailure();
    assert.deepEqual(logs()[0], ['OpenAI API request failed:', 'response-too-large']);
  });

  test('an oversized response streamed without Content-Length is rejected', async (t) => {
    const logs = captureLogs(t);
    const chunk = new TextEncoder().encode('x'.repeat(8192));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_PROVIDER_RESPONSE_BYTES * 4) return controller.close();
        controller.enqueue(chunk);
        sent += chunk.length;
      },
    });
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));
    await expectGenericFailure();
    assert.deepEqual(logs()[0], ['OpenAI API request failed:', 'response-too-large']);
    assert.ok(sent <= MAX_PROVIDER_RESPONSE_BYTES + 2 * chunk.length, `read ${sent} bytes`);
  });

  test('an oversized error response still logs only the status and "unknown"', async (t) => {
    const logs = captureLogs(t);
    const body = JSON.stringify({ error: { code: 'insufficient_quota', message: `EVIDENCE-CONTENT-MARKER ${'x'.repeat(MAX_PROVIDER_RESPONSE_BYTES)}` } });
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 429 }));
    await expectGenericFailure();
    assert.deepEqual(logs()[0], ['OpenAI API request failed:', 429, 'unknown']);
  });

  test('malformed provider JSON gives the generic failure without logging a snippet', async (t) => {
    const logs = captureLogs(t);
    t.mock.method(globalThis, 'fetch', async () => new Response('MODEL-OUTPUT-MARKER not json', { status: 200 }));
    await expectGenericFailure();
    const errors = logs();
    assert.deepEqual(errors[0], ['OpenAI API request failed:', 'malformed-response']);
  });

  test('a network failure gives the generic failure with a safe class', async (t) => {
    const logs = captureLogs(t);
    t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed: MODEL-OUTPUT-MARKER');
    });
    await expectGenericFailure();
    assert.deepEqual(logs()[0], ['OpenAI API request failed:', 'network-error']);
  });

  for (const status of [401, 429, 500]) {
    test(`provider HTTP ${status} gives the generic failure`, async (t) => {
      const logs = captureLogs(t);
      t.mock.method(globalThis, 'fetch', async () => new Response('{"error":{"message":"MODEL-OUTPUT-MARKER"}}', { status }));
      await expectGenericFailure();
      assert.deepEqual(logs()[0], ['OpenAI API request failed:', status, 'unknown']);
    });
  }

  test('the route failure log carries no provider or request content', async (t) => {
    const logs = captureLogs(t);
    t.mock.method(globalThis, 'fetch', async () => new Response('MODEL-OUTPUT-MARKER', { status: 200 }));
    await expectGenericFailure();
    const errors = logs();
    assert.equal(errors[1][0], '/api/chat failed:');
    assert.ok(!String(errors[1][1]).includes('MODEL-OUTPUT-MARKER'));
  });
});
