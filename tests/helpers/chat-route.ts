import type { TestContext } from 'node:test';
import { POST } from '@/app/api/chat/route';
import type { ChatErrorResponse, ChatSuccessResponse } from '@/lib/chat-types';

export type OpenAIRequestBody = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  max_tokens: number;
  response_format?: { type: string; json_schema: { name: string; strict: boolean } };
};

type MockOpenAIOptions = {
  // Raw message content, or a function of the request. Defaults to a valid grounded
  // answer citing the first evidence passage in the request.
  content?: string | null | ((request: OpenAIRequestBody) => string);
  refusal?: string;
  // The completion's finish_reason; null sends null, omitFinishReason leaves it out.
  finishReason?: string | null;
  omitFinishReason?: boolean;
  status?: number;
};

export function groundedContent(segments: Array<{ text: string; evidenceIds: string[] }>) {
  return JSON.stringify({ status: 'answered', segments });
}

// Evidence IDs supplied to the model, in context order.
export function evidenceIdsInRequest(call: OpenAIRequestBody) {
  const userMessage = call.messages.find((message) => message.role === 'user');
  return [...(userMessage?.content ?? '').matchAll(/^ID: (.*)$/gm)].map((match) => match[1]);
}

function defaultGroundedContent(request: OpenAIRequestBody) {
  return groundedContent([{ text: 'Mock answer', evidenceIds: evidenceIdsInRequest(request).slice(0, 1) }]);
}

export const FALLBACK_PREFIX = 'I could not find a clear answer in the approved source material.';
export const EMERGENCY_PREFIX = 'If there is immediate danger, contact emergency services immediately.';

// A question the approved sources do not cover, used to trigger the fixed fallback.
export const UNSUPPORTED_QUESTION = 'What is the weather like in Spain?';

// Replaces global fetch for the duration of one test so no request reaches OpenAI.
// Returns the parsed request bodies the route sent.
export function mockOpenAI(
  t: TestContext,
  { content = defaultGroundedContent, refusal, finishReason = 'stop', omitFinishReason = false, status = 200 }: MockOpenAIOptions = {}
) {
  const calls: OpenAIRequestBody[] = [];

  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as OpenAIRequestBody;
    calls.push(request);
    const messageContent = typeof content === 'function' ? content(request) : content;
    const body =
      status === 200
        ? {
            choices: [
              {
                message: { content: refusal ? null : messageContent, refusal: refusal ?? null },
                ...(omitFinishReason ? {} : { finish_reason: finishReason }),
              },
            ],
          }
        : { error: { message: 'mock upstream error' } };
    return new Response(JSON.stringify(body), { status });
  });

  return calls;
}

export function silenceConsole(t: TestContext) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
}

export async function postChat(body: unknown, { raw = false } = {}) {
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ? String(body) : JSON.stringify(body),
    })
  );
  return { status: response.status, json: await response.json() };
}

export async function askChat(message: string) {
  const { status, json } = await postChat({ message });
  return { status, json: json as ChatSuccessResponse };
}

export async function askChatExpectingError(body: unknown, options?: { raw?: boolean }) {
  const { status, json } = await postChat(body, options);
  return { status, json: json as ChatErrorResponse };
}

// Titles of the knowledge-base entries the route put into the model context, in rank order.
export function contextTitles(call: OpenAIRequestBody) {
  const userMessage = call.messages.find((message) => message.role === 'user');
  return [...(userMessage?.content ?? '').matchAll(/^Title: (.*)$/gm)].map((match) => match[1]);
}
