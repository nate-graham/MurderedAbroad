// Structured, evidence-linked model output: the JSON schema requested from OpenAI and
// the server-side validator that decides whether an answer may reach the user.
//
// Provider schema enforcement is not trusted on its own; every rule is checked here.
// Validation proves that each segment cites evidence retrieval selected. It cannot
// prove that the cited passage semantically supports the segment's wording.
import type { KnowledgeEntry } from '@/lib/knowledge-schema';

export type GroundedSegment = {
  text: string;
  evidenceIds: string[];
};

// What the OpenAI response contained, before validation.
export type ModelOutput =
  | { kind: 'content'; content: string; finishReason: string | null }
  | { kind: 'refusal' }
  | { kind: 'empty' };

export type GroundingFailureReason =
  | 'refusal'
  | 'empty-response'
  | 'abnormal-finish-reason'
  | 'malformed-json'
  | 'invalid-shape'
  | 'unexpected-field'
  | 'unknown-status'
  | 'no-segments'
  | 'blank-text'
  | 'missing-evidence'
  | 'invalid-evidence-id'
  | 'duplicate-evidence-id'
  | 'unselected-evidence-id'
  | 'metadata-in-text'
  | 'uncited-email'
  | 'uncited-phone';

export type GroundingResult =
  | { outcome: 'answered'; segments: GroundedSegment[] }
  | { outcome: 'unsupported' }
  | { outcome: 'rejected'; reason: GroundingFailureReason };

// OpenAI Chat Completions `response_format` for a strict JSON schema. Uses only
// widely supported schema keywords; evidence IDs are limited to the passages selected
// for this question.
export function groundedAnswerResponseFormat(selectedEvidenceIds: string[]) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'grounded_answer',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'segments'],
        properties: {
          status: { type: 'string', enum: ['answered', 'unsupported'] },
          segments: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'evidenceIds'],
              properties: {
                text: { type: 'string' },
                evidenceIds: { type: 'array', items: { type: 'string', enum: selectedEvidenceIds } },
              },
            },
          },
        },
      },
    },
  };
}

const ROOT_FIELDS = ['status', 'segments'];
const SEGMENT_FIELDS = ['text', 'evidenceIds'];

// Only a normally completed response may be used. Anything else (cut off, filtered,
// a tool call, or an unknown or missing reason) falls back.
const ACCEPTED_FINISH_REASON = 'stop';

// Answer text may not carry source metadata: only the server adds citation markers,
// and sources are shown from the approved corpus.

// Evidence IDs are "<publisher namespace>-<kebab-case words>" (the namespaces are tested
// to cover every corpus ID). Matched whether or not the ID was selected.
const EVIDENCE_ID_NAMESPACES = ['govuk', 'ma'];
const EVIDENCE_ID_PATTERN = new RegExp(`\\b(?:${EVIDENCE_ID_NAMESPACES.join('|')})-[a-z0-9]+(?:-[a-z0-9]+)*\\b`, 'i');

// Numeric citation markers: [1], [12], [1,2], [1, 2], [1-3], [1; 2]. Ordinary bracketed
// words such as "[sic]" are allowed.
const CITATION_MARKER_PATTERN = /\[\s*\d+(?:\s*[,;\u2013\u2014-]\s*\d+)*\s*\]/;

// Links: any URL scheme, "www.", or a protocol-relative "//host".
const LINK_PATTERNS = [/\b[a-z][a-z0-9+.-]*:\/\//i, /\bwww\./i, /(?:^|[^\w:/])\/\/[a-z0-9]/i];

// Email tokens. One recogniser decides both which spans are email addresses (checked
// against the cited evidence) and which spans are hidden from domain detection, so text
// cannot be masked as an email without being checked as one.
//
// A token is a whitespace-separated word with wrapping punctuation removed. It is an
// email address only if the whole token is local@domain: the local part uses RFC 5322
// "atext" characters (minus "/", a URL path character) in dot-separated runs, and the
// domain is dot-separated labels ending in a letter TLD. Matching the whole token means
// "help!support@example.org" is never reduced to a shorter address inside it.
const EMAIL_LOCAL_CHARS = "A-Za-z0-9!#$%&'*+=?^_`{|}~-";
const EMAIL_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const EMAIL_TOKEN_PATTERN = new RegExp(
  `^[${EMAIL_LOCAL_CHARS}]+(?:\\.[${EMAIL_LOCAL_CHARS}]+)*@(?:${EMAIL_LABEL}\\.)+[A-Za-z]{2,24}$`
);
const LEADING_WRAPPERS = /^[(\[<"'\u201c\u2018]+/;
const TRAILING_WRAPPERS = /[)\]>"'\u201d\u2019.,;:!?]+$/;

type EmailToken = { address: string; start: number; end: number };

function extractEmailTokens(text: string): EmailToken[] {
  const tokens: EmailToken[] = [];
  for (const word of text.matchAll(/\S+/g)) {
    const leading = word[0].match(LEADING_WRAPPERS)?.[0].length ?? 0;
    const core = word[0].slice(leading).replace(TRAILING_WRAPPERS, '');
    if (!EMAIL_TOKEN_PATTERN.test(core)) continue;
    const start = word.index + leading;
    tokens.push({ address: core.toLowerCase(), start, end: start + core.length });
  }
  return tokens;
}

function maskEmailTokens(text: string, emails: EmailToken[]) {
  return emails.reduceRight(
    (masked, { start, end }) => `${masked.slice(0, start)}${' '.repeat(end - start)}${masked.slice(end)}`,
    text
  );
}

// Bare domains such as "evil.com" or "evil.example/help". Recognised email tokens and the
// publisher name "GOV.UK" are masked first.
const PUBLISHER_NAME_PATTERN = /\bGOV\.UK\b(?!\/)/g;
const DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b/i;

function containsSourceMetadata(text: string, emails: EmailToken[]) {
  const withoutAllowedNames = maskEmailTokens(text, emails).replace(PUBLISHER_NAME_PATTERN, ' ');
  return (
    EVIDENCE_ID_PATTERN.test(text) ||
    CITATION_MARKER_PATTERN.test(text) ||
    LINK_PATTERNS.some((pattern) => pattern.test(text)) ||
    DOMAIN_PATTERN.test(withoutAllowedNames)
  );
}

// An email address in answer text must appear, as a complete email token, in the
// evidence that segment cites, so the model cannot supply its own contact address.
function hasUncitedEmail(emails: EmailToken[], citedEntries: KnowledgeEntry[]) {
  if (emails.length === 0) return false;
  const cited = new Set(citedEntries.flatMap((entry) => extractEmailTokens(entry.content).map((email) => email.address)));
  return emails.some((email) => !cited.has(email.address));
}

// Phone numbers. A candidate is a run of digits that may include a leading "+", spaces,
// hyphens, dots, slashes and parentheses; it is a phone number if it has at least 9
// digits, which excludes dates, years, prices and short counts. Numbers are compared
// digits-only (keeping a leading "+"), so "0845 123 2384", "0845.123.2384" and
// "(0845) 1232384" match, while "+44 845 123 2384" is a different number. A phone
// number in answer text must appear in the evidence that segment cites.
const PHONE_CANDIDATE_PATTERN = /\+?\(?\d[\d ()\t./-]*\d/g;
const MIN_PHONE_DIGITS = 9;

function extractPhoneNumbers(text: string): string[] {
  const numbers: string[] = [];
  for (const match of text.matchAll(PHONE_CANDIDATE_PATTERN)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= MIN_PHONE_DIGITS) numbers.push(`${match[0].startsWith('+') ? '+' : ''}${digits}`);
  }
  return numbers;
}

function hasUncitedPhone(text: string, citedEntries: KnowledgeEntry[]) {
  const written = extractPhoneNumbers(text);
  if (written.length === 0) return false;
  const cited = new Set(citedEntries.flatMap((entry) => extractPhoneNumbers(entry.content)));
  return written.some((number) => !cited.has(number));
}

class GroundingError extends Error {
  constructor(readonly reason: GroundingFailureReason) {
    super(reason);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkFields(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value);
  if (keys.some((key) => !expected.includes(key))) throw new GroundingError('unexpected-field');
  if (expected.some((key) => !(key in value))) throw new GroundingError('invalid-shape');
}

function validateSegment(value: unknown, selectedById: ReadonlyMap<string, KnowledgeEntry>): GroundedSegment {
  if (!isRecord(value)) throw new GroundingError('invalid-shape');
  checkFields(value, SEGMENT_FIELDS);

  const { text, evidenceIds } = value;
  if (typeof text !== 'string' || text.trim() === '') throw new GroundingError('blank-text');
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) throw new GroundingError('missing-evidence');

  const ids: string[] = [];
  const citedEntries: KnowledgeEntry[] = [];
  for (const id of evidenceIds) {
    if (typeof id !== 'string' || id.trim() === '') throw new GroundingError('invalid-evidence-id');
    if (ids.includes(id)) throw new GroundingError('duplicate-evidence-id');
    const entry = selectedById.get(id);
    if (!entry) throw new GroundingError('unselected-evidence-id');
    ids.push(id);
    citedEntries.push(entry);
  }

  const trimmed = text.trim();
  const emails = extractEmailTokens(trimmed);
  if (containsSourceMetadata(trimmed, emails)) throw new GroundingError('metadata-in-text');
  if (hasUncitedEmail(emails, citedEntries)) throw new GroundingError('uncited-email');
  if (hasUncitedPhone(trimmed, citedEntries)) throw new GroundingError('uncited-phone');

  return { text: trimmed, evidenceIds: ids };
}

function validate(output: ModelOutput, selectedById: ReadonlyMap<string, KnowledgeEntry>): GroundingResult {
  if (output.kind === 'refusal') throw new GroundingError('refusal');
  if (output.kind === 'empty') throw new GroundingError('empty-response');
  if (output.finishReason !== ACCEPTED_FINISH_REASON) throw new GroundingError('abnormal-finish-reason');

  let parsed: unknown;
  try {
    parsed = JSON.parse(output.content);
  } catch {
    throw new GroundingError('malformed-json');
  }

  if (!isRecord(parsed)) throw new GroundingError('invalid-shape');
  checkFields(parsed, ROOT_FIELDS);

  const { status, segments } = parsed;
  if (status !== 'answered' && status !== 'unsupported') throw new GroundingError('unknown-status');
  if (!Array.isArray(segments)) throw new GroundingError('invalid-shape');
  if (status === 'unsupported') return { outcome: 'unsupported' };
  if (segments.length === 0) throw new GroundingError('no-segments');

  return { outcome: 'answered', segments: segments.map((segment) => validateSegment(segment, selectedById)) };
}

// `selectedEntries` are the passages retrieval selected for this question: the only
// evidence a segment may cite, and the authority for any email address or phone number
// it writes.
export function validateGroundedOutput(output: ModelOutput, selectedEntries: readonly KnowledgeEntry[]): GroundingResult {
  try {
    return validate(output, new Map(selectedEntries.map((entry) => [entry.id, entry])));
  } catch (error) {
    if (error instanceof GroundingError) return { outcome: 'rejected', reason: error.reason };
    throw error;
  }
}
