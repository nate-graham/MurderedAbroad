// Parsing and validation of POST /api/chat request bodies.
import { BodyTooLargeError, readBoundedText } from '@/lib/bounded-body';

// Longest accepted question, in characters (Unicode code points) after trimming.
// Real questions are a sentence or a short paragraph; 4,000 characters (roughly 600-700
// words) leaves room for someone to describe their situation in detail while bounding
// the prompt size and the work done per request.
export const MAX_MESSAGE_CHARACTERS = 4000;

// Largest accepted request body, in bytes, enforced while reading and before JSON
// parsing. This is an intentional transport limit, not a guarantee that every possible
// encoding of a 4,000-code-point message fits. Normal browser JSON serialisation (as the
// chat UI's JSON.stringify produces) sends non-ASCII characters as raw UTF-8: at most 4
// bytes per code point, so about 16 KB plus a few bytes of JSON envelope, which fits
// comfortably. A client that escapes every astral character as a surrogate pair
// (\uXXXX\uXXXX, 12 bytes each) could need about 48 KB for the same message and is
// refused with 413; that is acceptable because no normal client serialises that way.
export const MAX_REQUEST_BODY_BYTES = 32 * 1024;

export const INVALID_REQUEST_ERROR = 'Please enter a question.';
export const MESSAGE_TOO_LONG_ERROR = `Please shorten your question to ${MAX_MESSAGE_CHARACTERS.toLocaleString('en-GB')} characters or fewer.`;

export type ChatRequestResult =
  | { ok: true; message: string }
  | { ok: false; status: 400 | 413 | 415; error: string };

// application/json, optionally with a UTF-8 charset parameter (any case).
function isJsonContentType(contentType: string | null) {
  if (!contentType) return false;
  const [mediaType, ...parameters] = contentType.split(';').map((part) => part.trim().toLowerCase());
  if (mediaType !== 'application/json') return false;
  return parameters.every((parameter) => parameter === '' || /^charset="?utf-8"?$/.test(parameter));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reads the question from a request. Never throws; never truncates. The media type is
// checked before the body is read, and the body size before it is parsed.
export async function readChatRequest(request: Request): Promise<ChatRequestResult> {
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return { ok: false, status: 415, error: INVALID_REQUEST_ERROR };
  }

  let body: unknown;
  try {
    const text = await readBoundedText(request.body, request.headers.get('content-length'), MAX_REQUEST_BODY_BYTES);
    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return { ok: false, status: 413, error: MESSAGE_TOO_LONG_ERROR };
    return { ok: false, status: 400, error: INVALID_REQUEST_ERROR };
  }

  if (!isRecord(body)) {
    return { ok: false, status: 400, error: INVALID_REQUEST_ERROR };
  }

  const { message } = body;
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed) {
    return { ok: false, status: 400, error: INVALID_REQUEST_ERROR };
  }

  return { ok: true, message: trimmed };
}

export function isMessageTooLong(message: string) {
  return Array.from(message).length > MAX_MESSAGE_CHARACTERS;
}
