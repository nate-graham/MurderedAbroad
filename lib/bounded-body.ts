// Reads an HTTP body as UTF-8 text without ever holding more than a fixed number of
// bytes. Used for incoming chat requests and for OpenAI responses, so neither a client
// nor the provider can make the server buffer an unbounded body.
//
// A declared Content-Length above the limit is rejected before reading, but the header is
// never trusted: the bytes actually received are counted, and reading stops as soon as
// they exceed the limit, whatever the header said or whether it was sent at all.

export class BodyTooLargeError extends Error {
  constructor() {
    super('Body exceeds the size limit');
    this.name = 'BodyTooLargeError';
  }
}

export class InvalidEncodingError extends Error {
  constructor() {
    super('Body is not valid UTF-8');
    this.name = 'InvalidEncodingError';
  }
}

function declaredLength(contentLength: string | null) {
  if (contentLength === null || !/^\d+$/.test(contentLength.trim())) return null;
  return Number(contentLength.trim());
}

// Throws BodyTooLargeError when the body is over maxBytes, InvalidEncodingError when it
// is not valid UTF-8, and whatever the stream throws (for example an AbortError) if reading fails.
export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  maxBytes: number
): Promise<string> {
  if (body === null) return '';

  const declared = declaredLength(contentLength);
  if (declared !== null && declared > maxBytes) {
    await body.cancel().catch(() => {});
    throw new BodyTooLargeError();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidEncodingError();
  }
}
