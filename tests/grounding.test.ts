// Unit tests for lib/grounding.ts: the structured-output schema and the server-side
// validator that decides whether a model answer may reach the user.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { groundedAnswerResponseFormat, validateGroundedOutput, type ModelOutput } from '@/lib/grounding';
import { parseKnowledgeBase } from '@/lib/knowledge-schema';

// The passages retrieval selected, as the validator receives them.
const SELECTED = parseKnowledgeBase(knowledgeBaseJson).filter((entry) => ['govuk-lawyers-abroad', 'govuk-financial-support-and-costs'].includes(entry.id));

function content(value: unknown, finishReason = 'stop'): ModelOutput {
  return { kind: 'content', content: typeof value === 'string' ? value : JSON.stringify(value), finishReason };
}

function answered(segments: unknown[]) {
  return content({ status: 'answered', segments });
}

function rejectionReason(output: ModelOutput) {
  const result = validateGroundedOutput(output, SELECTED);
  assert.equal(result.outcome, 'rejected', `expected rejection, got ${result.outcome}`);
  return result.outcome === 'rejected' ? result.reason : null;
}

describe('groundedAnswerResponseFormat', () => {
  test('requests strict JSON-schema output restricted to the selected evidence IDs', () => {
    const format = groundedAnswerResponseFormat(['govuk-lawyers-abroad', 'ma-contact-support']);

    assert.equal(format.type, 'json_schema');
    assert.equal(format.json_schema.strict, true);
    const { schema } = format.json_schema;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['status', 'segments']);
    assert.deepEqual(schema.properties.status.enum, ['answered', 'unsupported']);
    const segment = schema.properties.segments.items;
    assert.equal(segment.additionalProperties, false);
    assert.deepEqual(segment.required, ['text', 'evidenceIds']);
    assert.deepEqual(segment.properties.evidenceIds.items.enum, ['govuk-lawyers-abroad', 'ma-contact-support']);
  });
});

describe('validateGroundedOutput: accepted', () => {
  test('one segment with one selected evidence ID', () => {
    const result = validateGroundedOutput(
      answered([{ text: 'You could consider a local lawyer.', evidenceIds: ['govuk-lawyers-abroad'] }]),
      SELECTED
    );
    assert.deepEqual(result, {
      outcome: 'answered',
      segments: [{ text: 'You could consider a local lawyer.', evidenceIds: ['govuk-lawyers-abroad'] }],
    });
  });

  test('several segments, one citing two IDs; text is trimmed', () => {
    const result = validateGroundedOutput(
      answered([
        { text: '  First.  ', evidenceIds: ['govuk-lawyers-abroad'] },
        { text: 'Second.', evidenceIds: ['govuk-financial-support-and-costs', 'govuk-lawyers-abroad'] },
      ]),
      SELECTED
    );
    assert.equal(result.outcome, 'answered');
    assert.deepEqual(result.outcome === 'answered' ? result.segments.map((segment) => segment.text) : [], ['First.', 'Second.']);
  });

  test('status "unsupported" is recognised (never shown to the user)', () => {
    assert.deepEqual(validateGroundedOutput(content({ status: 'unsupported', segments: [] }), SELECTED), {
      outcome: 'unsupported',
    });
  });
});

describe('validateGroundedOutput: rejected', () => {
  test('model refusal', () => {
    assert.equal(rejectionReason({ kind: 'refusal' }), 'refusal');
  });

  test('empty model response', () => {
    assert.equal(rejectionReason({ kind: 'empty' }), 'empty-response');
  });

  test('output cut off by the token limit, even if it parses', () => {
    const output = content({ status: 'answered', segments: [{ text: 'A.', evidenceIds: ['govuk-lawyers-abroad'] }] }, 'length');
    assert.equal(rejectionReason(output), 'abnormal-finish-reason');
  });

  test('malformed JSON', () => {
    assert.equal(rejectionReason(content('{"status": "answered", "segments": [')), 'malformed-json');
    assert.equal(rejectionReason(content('Here is my answer.')), 'malformed-json');
  });

  test('non-object root', () => {
    assert.equal(rejectionReason(content('[]')), 'invalid-shape');
    assert.equal(rejectionReason(content('"answered"')), 'invalid-shape');
    assert.equal(rejectionReason(content('null')), 'invalid-shape');
  });

  test('missing fields', () => {
    assert.equal(rejectionReason(content({ status: 'answered' })), 'invalid-shape');
    assert.equal(rejectionReason(content({ segments: [] })), 'invalid-shape');
  });

  test('unexpected fields at the root or in a segment', () => {
    assert.equal(rejectionReason(content({ status: 'answered', segments: [], sources: [] })), 'unexpected-field');
    assert.equal(
      rejectionReason(
        answered([{ text: 'A.', evidenceIds: ['govuk-lawyers-abroad'], sourceUrl: 'https://example.org/' }])
      ),
      'unexpected-field'
    );
  });

  test('unknown status', () => {
    assert.equal(rejectionReason(content({ status: 'partial', segments: [] })), 'unknown-status');
  });

  test('segments that are not an array', () => {
    assert.equal(rejectionReason(content({ status: 'answered', segments: 'A.' })), 'invalid-shape');
  });

  test('an answered response with no segments', () => {
    assert.equal(rejectionReason(answered([])), 'no-segments');
  });

  test('a segment that is not an object', () => {
    assert.equal(rejectionReason(answered(['A.'])), 'invalid-shape');
  });

  test('blank or non-string text', () => {
    assert.equal(rejectionReason(answered([{ text: '   ', evidenceIds: ['govuk-lawyers-abroad'] }])), 'blank-text');
    assert.equal(rejectionReason(answered([{ text: 3, evidenceIds: ['govuk-lawyers-abroad'] }])), 'blank-text');
  });

  test('missing or empty evidence IDs', () => {
    assert.equal(rejectionReason(answered([{ text: 'A.', evidenceIds: [] }])), 'missing-evidence');
    assert.equal(rejectionReason(answered([{ text: 'A.', evidenceIds: 'govuk-lawyers-abroad' }])), 'missing-evidence');
  });

  test('a later uncited segment rejects the whole answer', () => {
    assert.equal(
      rejectionReason(
        answered([
          { text: 'Supported.', evidenceIds: ['govuk-lawyers-abroad'] },
          { text: 'Uncited claim.', evidenceIds: [] },
        ])
      ),
      'missing-evidence'
    );
  });

  test('non-string or blank evidence IDs', () => {
    assert.equal(rejectionReason(answered([{ text: 'A.', evidenceIds: [7] }])), 'invalid-evidence-id');
    assert.equal(rejectionReason(answered([{ text: 'A.', evidenceIds: [''] }])), 'invalid-evidence-id');
  });

  test('duplicate IDs within one segment are rejected, not silently merged', () => {
    assert.equal(
      rejectionReason(answered([{ text: 'A.', evidenceIds: ['govuk-lawyers-abroad', 'govuk-lawyers-abroad'] }])),
      'duplicate-evidence-id'
    );
  });

  test('an invented ID is rejected, not silently dropped', () => {
    assert.equal(
      rejectionReason(answered([{ text: 'A.', evidenceIds: ['govuk-lawyers-abroad', 'govuk-made-up-source'] }])),
      'unselected-evidence-id'
    );
  });

  test('a real corpus ID that retrieval did not select is rejected', () => {
    assert.equal(rejectionReason(answered([{ text: 'A.', evidenceIds: ['ma-contact-support'] }])), 'unselected-evidence-id');
  });

  test('citation markers, URLs or evidence IDs written into the text are rejected', () => {
    for (const text of [
      'You can appoint a lawyer [1].',
      'See https://www.gov.uk/ for details.',
      'As govuk-lawyers-abroad says, you can appoint a lawyer.',
    ]) {
      assert.equal(rejectionReason(answered([{ text, evidenceIds: ['govuk-lawyers-abroad'] }])), 'metadata-in-text', text);
    }
  });
});
