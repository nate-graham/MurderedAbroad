// Raw request hardening (Phase 3B): media type, body size bound before parsing, cache
// headers and the generation kill switch. Written before the implementation.
import assert from 'node:assert/strict';
import { promises as fsPromises } from 'node:fs';
import { afterEach, beforeEach, describe, test, type TestContext } from 'node:test';
import { POST } from '@/app/api/chat/route';
import { MAX_REQUEST_BODY_BYTES } from '@/lib/chat-request';
import { FALLBACK_PREFIX, EMERGENCY_PREFIX, mockOpenAI } from './helpers/chat-route';

const TOO_LARGE = { error: 'Please shorten your question to 4,000 characters or fewer.' };
const INVALID = { error: 'Please enter a question.' };

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.CHAT_GENERATION_DISABLED;
});

afterEach(() => {
  delete process.env.CHAT_GENERATION_DISABLED;
});

function jsonRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit);
}

// A body stream with no Content-Length, delivered in chunks.
function streamOf(text: string, chunkSize = 1024) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

// A JSON body of exactly `size` bytes. With space padding the trimmed message is the
// supported question "lawyers"; other padding makes the message itself that long.
function bodyOfSize(size: number, pad = ' ') {
  const prefix = '{"message":"lawyers ';
  const suffix = '"}';
  return `${prefix}${pad.repeat(size - prefix.length - suffix.length)}${suffix}`;
}

// Watches for work a rejected request must never do.
function watch(t: TestContext) {
  const openAI = mockOpenAI(t);
  const readFile = t.mock.method(fsPromises, 'readFile', fsPromises.readFile.bind(fsPromises));
  const errors = t.mock.method(console, 'error', () => {});
  const warnings = t.mock.method(console, 'warn', () => {});
  return { openAI, readFile, errors, warnings };
}

function assertNoWork(watched: ReturnType<typeof watch>) {
  assert.equal(watched.openAI.length, 0, 'OpenAI was called');
  assert.equal(watched.readFile.mock.callCount(), 0, 'the knowledge base was read');
  assert.equal(watched.errors.mock.callCount(), 0, 'an error was logged');
}

async function send(request: Request) {
  const response = await POST(request);
  return { status: response.status, headers: response.headers, json: await response.json() };
}

describe('request body size bound', () => {
  test('the bound is 32 KiB', () => {
    assert.equal(MAX_REQUEST_BODY_BYTES, 32 * 1024);
  });

  test('a body under the bound is processed', async (t) => {
    const watched = watch(t);
    const { status } = await send(jsonRequest(bodyOfSize(1024)));
    assert.equal(status, 200);
    assert.equal(watched.openAI.length, 1);
  });

  test('a body of exactly the bound is read (then subject to the message limit)', async (t) => {
    const watched = watch(t);
    const { status, json } = await send(jsonRequest(bodyOfSize(MAX_REQUEST_BODY_BYTES, 'x')));
    // 32 KiB of message text exceeds the separate 4,000-character message limit.
    assert.equal(status, 400);
    assert.deepEqual(json, TOO_LARGE);
    assertNoWork(watched);
  });

  test('a body one byte over the bound returns 413 without parsing or work', async (t) => {
    const watched = watch(t);
    const { status, json } = await send(jsonRequest(bodyOfSize(MAX_REQUEST_BODY_BYTES + 1)));
    assert.equal(status, 413);
    assert.deepEqual(json, TOO_LARGE);
    assertNoWork(watched);
  });

  test('an oversized declared Content-Length is rejected without reading the body', async (t) => {
    const watched = watch(t);
    let pulled = false;
    // highWaterMark 0: the stream only pulls when something actually reads it.
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
          throw new Error('the body must not be read');
        },
      },
      { highWaterMark: 0 }
    );
    const { status } = await send(jsonRequest(body, { 'content-length': String(10 * 1024 * 1024) }));
    assert.equal(status, 413);
    assert.equal(pulled, false);
    assertNoWork(watched);
  });

  test('a body with no Content-Length is still bounded while streaming', async (t) => {
    const watched = watch(t);
    const { status } = await send(jsonRequest(streamOf(bodyOfSize(MAX_REQUEST_BODY_BYTES * 4))));
    assert.equal(status, 413);
    assertNoWork(watched);
  });

  test('a small valid body with no Content-Length is processed', async (t) => {
    const watched = watch(t);
    const { status } = await send(jsonRequest(streamOf('{"message":"lawyers"}')));
    assert.equal(status, 200);
    assert.equal(watched.openAI.length, 1);
  });

  test('a Content-Length that understates the body does not bypass the bound', async (t) => {
    const watched = watch(t);
    const { status } = await send(jsonRequest(bodyOfSize(MAX_REQUEST_BODY_BYTES * 2), { 'content-length': '20' }));
    assert.equal(status, 413);
    assertNoWork(watched);
  });

  test('malformed JSON within the bound returns 400', async (t) => {
    const watched = watch(t);
    const { status, json } = await send(jsonRequest('{"message": "lawyers"'));
    assert.equal(status, 400);
    assert.deepEqual(json, INVALID);
    assertNoWork(watched);
  });

  test('an oversized malformed payload returns 413 without parsing', async (t) => {
    const watched = watch(t);
    const { status } = await send(jsonRequest(`{${'x'.repeat(MAX_REQUEST_BODY_BYTES * 2)}`));
    assert.equal(status, 413);
    assertNoWork(watched);
  });

  test('invalid UTF-8 within the bound returns 400', async (t) => {
    const watched = watch(t);
    const { status } = await send(jsonRequest(new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])));
    assert.equal(status, 400);
    assertNoWork(watched);
  });
});

describe('media type', () => {
  for (const contentType of ['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8']) {
    test(`"${contentType}" is accepted`, async (t) => {
      mockOpenAI(t);
      const { status } = await send(jsonRequest('{"message":"lawyers"}', { 'content-type': contentType }));
      assert.equal(status, 200);
    });
  }

  for (const contentType of [
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/jsonp',
    // JSON exchanged between systems must be UTF-8 (RFC 8259).
    'application/json; charset=iso-8859-1',
    '',
  ]) {
    test(`"${contentType || '(none)'}" returns 415 without parsing or work`, async (t) => {
      const watched = watch(t);
      const request = new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: contentType ? { 'content-type': contentType } : {},
        body: '{"message":"lawyers"}',
      });
      if (!contentType) request.headers.delete('content-type');
      const { status, json } = await send(request);
      assert.equal(status, 415);
      assert.deepEqual(json, INVALID);
      assertNoWork(watched);
    });
  }

  test('the route only handles POST', async () => {
    const route = await import('@/app/api/chat/route');
    const handlers = Object.keys(route).filter((name) => /^(GET|HEAD|PUT|PATCH|DELETE|OPTIONS)$/.test(name));
    assert.deepEqual(handlers, []);
  });
});

describe('API responses are never cached', () => {
  test('success, fallback, emergency and error responses all carry Cache-Control: no-store', async (t) => {
    mockOpenAI(t);
    t.mock.method(console, 'warn', () => {});
    const cases: Array<[string, Request]> = [
      ['answer', jsonRequest('{"message":"lawyers"}')],
      ['fallback', jsonRequest('{"message":"What is the weather like in Spain?"}')],
      ['emergency', jsonRequest('{"message":"I am in immediate danger"}')],
      ['400', jsonRequest('{')],
      ['413', jsonRequest(bodyOfSize(MAX_REQUEST_BODY_BYTES + 1))],
      ['415', new Request('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })],
    ];
    for (const [label, request] of cases) {
      const { headers } = await send(request);
      assert.equal(headers.get('cache-control'), 'no-store', label);
    }
  });
});

describe('generation kill switch', () => {
  test('CHAT_GENERATION_DISABLED=true stops OpenAI calls and returns the fixed fallback', async (t) => {
    process.env.CHAT_GENERATION_DISABLED = 'true';
    const watched = watch(t);
    const { status, json } = await send(jsonRequest('{"message":"lawyers"}'));
    assert.equal(status, 200);
    assert.ok(json.answer.startsWith(FALLBACK_PREFIX));
    assert.equal(json.fallbackUsed, true);
    assert.equal(watched.openAI.length, 0);
    assert.equal(watched.readFile.mock.callCount(), 0);
  });

  test('crisis detection still runs while generation is disabled', async (t) => {
    process.env.CHAT_GENERATION_DISABLED = 'true';
    const watched = watch(t);
    const { json } = await send(jsonRequest('{"message":"I want to die"}'));
    assert.ok(json.answer.startsWith(EMERGENCY_PREFIX));
    assert.equal(watched.openAI.length, 0);
  });

  test('any other value leaves generation enabled', async (t) => {
    process.env.CHAT_GENERATION_DISABLED = 'false';
    const watched = watch(t);
    await send(jsonRequest('{"message":"lawyers"}'));
    assert.equal(watched.openAI.length, 1);
  });
});
