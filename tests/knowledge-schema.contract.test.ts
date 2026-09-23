// Contract tests for parseKnowledgeBase: validation must not rewrite source content.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseKnowledgeBase } from '@/lib/knowledge-schema';

describe('parseKnowledgeBase content preservation', () => {
  test('retains string values exactly, without trimming or rewriting', () => {
    const entry = {
      title: '  Padded title  ',
      sourceName: ' GOV.UK ',
      sourceUrl: 'https://www.gov.uk/example?x=1#section',
      category: ' first_steps ',
      content: '  Line one.\n\nLine two with “curly quotes”, an en dash – and trailing space.  ',
    };

    assert.deepEqual(parseKnowledgeBase([entry]), [entry]);
  });

  test('does not mutate the input', () => {
    const input = [
      {
        title: ' T ',
        sourceName: 'S',
        sourceUrl: 'https://example.org/',
        category: 'c',
        content: ' C ',
        extra: 'kept on input',
      },
    ];
    const snapshot = structuredClone(input);

    parseKnowledgeBase(input);

    assert.deepEqual(input, snapshot);
  });

  // CURRENT BEHAVIOUR (temporary): unknown fields are silently dropped.
  // Phase 2B introduces stable IDs and must update the schema in the same change;
  // update this test deliberately at that point.
  test('CURRENT BEHAVIOUR (temporary): unknown fields are dropped', () => {
    const [parsed] = parseKnowledgeBase([
      {
        id: 'lawyers-abroad',
        title: 'Lawyers abroad',
        sourceName: 'GOV.UK',
        sourceUrl: 'https://www.gov.uk/example',
        category: 'lawyers',
        content: 'Content',
        extra: 'ignored',
      },
    ]);

    assert.deepEqual(Object.keys(parsed), ['title', 'sourceName', 'sourceUrl', 'category', 'content']);
    assert.ok(!('id' in parsed));
    assert.ok(!('extra' in parsed));
  });
});
