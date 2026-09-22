import type { TestContext } from 'node:test';
import { POST } from '@/app/api/chat/route';
import type { ChatErrorResponse, ChatSuccessResponse } from '@/lib/chat-types';

export type OpenAIRequestBody = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  max_tokens: number;
};

type MockOpenAIOptions = {
  content?: string | null;
  status?: number;
};

export const FALLBACK_PREFIX = 'I could not find a clear answer in the approved source material.';
export const EMERGENCY_PREFIX = 'If there is immediate danger, contact emergency services immediately.';

// Replaces global fetch for the duration of one test so no request reaches OpenAI.
// Returns the parsed request bodies the route sent.
export function mockOpenAI(t: TestContext, { content = 'Mock answer', status = 200 }: MockOpenAIOptions = {}) {
  const calls: OpenAIRequestBody[] = [];

  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as OpenAIRequestBody);
    const body =
      status === 200
        ? { choices: [{ message: { content } }] }
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
