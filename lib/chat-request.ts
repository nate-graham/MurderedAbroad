// Parsing and validation of POST /api/chat request bodies.

// Longest accepted question, in characters (Unicode code points) after trimming.
// Real questions are a sentence or a short paragraph; 4,000 characters (roughly 600-700
// words) leaves room for someone to describe their situation in detail while bounding
// the prompt size and the work done per request.
export const MAX_MESSAGE_CHARACTERS = 4000;

export const INVALID_REQUEST_ERROR = 'Please enter a question.';
export const MESSAGE_TOO_LONG_ERROR = `Please shorten your question to ${MAX_MESSAGE_CHARACTERS.toLocaleString('en-GB')} characters or fewer.`;

export type ChatRequestResult = { ok: true; message: string } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reads the question from a request. Never throws; never truncates.
export async function readChatRequest(request: Request): Promise<ChatRequestResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: INVALID_REQUEST_ERROR };
  }

  if (!isRecord(body)) {
    return { ok: false, error: INVALID_REQUEST_ERROR };
  }

  const { message } = body;
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed) {
    return { ok: false, error: INVALID_REQUEST_ERROR };
  }

  return { ok: true, message: trimmed };
}

export function isMessageTooLong(message: string) {
  return Array.from(message).length > MAX_MESSAGE_CHARACTERS;
}
