// Contract tests for parseKnowledgeBase: validation must not rewrite source content,
// must retain evidence IDs and must reject undocumented fields.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { KnowledgeBaseValidationError, parseKnowledgeBase } from '@/lib/knowledge-schema';

const validEntry = {
  id: 'govuk-lawyers-abroad',
  title: 'Lawyers abroad',
  sourceName: 'GOV.UK',
  sourceUrl: 'https://www.gov.uk/example',
  category: 'lawyers',
  content: 'Content',
};

describe('parseKnowledgeBase content preservation', () => {
  test('retains string values exactly, without trimming or rewriting', () => {
    const entry = {
      id: 'padded-entry',
      title: '  Padded title  ',
      sourceName: ' GOV.UK ',
      sourceUrl: 'https://www.gov.uk/example?x=1#section',
      category: ' first_steps ',
      content: '  Line one.\n\nLine two with “curly quotes”, an en dash – and trailing space.  ',
    };

    assert.deepEqual(parseKnowledgeBase([entry]), [entry]);
  });

  test('does not mutate the input', () => {
    const input = [{ ...validEntry, title: ' T ', content: ' C ' }];
    const snapshot = structuredClone(input);

    parseKnowledgeBase(input);

    assert.deepEqual(input, snapshot);
  });

  test('retains the evidence id', () => {
    const [parsed] = parseKnowledgeBase([validEntry]);

    assert.equal(parsed.id, 'govuk-lawyers-abroad');
    assert.deepEqual(Object.keys(parsed), ['id', 'title', 'sourceName', 'sourceUrl', 'category', 'content']);
  });
});

describe('parseKnowledgeBase id and field rules', () => {
  test('rejects an unknown field instead of silently dropping it', () => {
    assert.throws(
      () => parseKnowledgeBase([{ ...validEntry, reviewedBy: 'someone' }]),
      (error: unknown) =>
        error instanceof KnowledgeBaseValidationError &&
        error.message === 'Entry 0 has an unknown field "reviewedBy"'
    );
  });

  test('rejects a missing id', () => {
    const { id: _id, ...withoutId } = validEntry;
    assert.throws(() => parseKnowledgeBase([withoutId]), /Entry 0 has a missing or empty "id"/);
  });

  for (const badId of ['Govuk-Lawyers', 'govuk_lawyers', 'govuk--lawyers', '-govuk', 'govuk-', 'govuk lawyers']) {
    test(`rejects id "${badId}" that is not lowercase kebab-case`, () => {
      assert.throws(
        () => parseKnowledgeBase([{ ...validEntry, id: badId }]),
        /must be lowercase kebab-case/
      );
    });
  }

  test('rejects duplicate ids and names both positions', () => {
    assert.throws(
      () => parseKnowledgeBase([validEntry, { ...validEntry, title: 'Another' }]),
      (error: unknown) =>
        error instanceof KnowledgeBaseValidationError &&
        error.message === 'Duplicate id "govuk-lawyers-abroad" at entries 0 and 1'
    );
  });
});
