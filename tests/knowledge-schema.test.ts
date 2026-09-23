import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBase from '@/data/knowledge-base.json';
import { KnowledgeBaseValidationError, parseKnowledgeBase } from '@/lib/knowledge-schema';

const validEntry = {
  id: 'example-entry',
  title: 'Title',
  sourceName: 'GOV.UK',
  sourceUrl: 'https://www.gov.uk/example',
  category: 'example',
  content: 'Content',
};

describe('knowledge schema', () => {
  test('current knowledge base is valid', () => {
    const entries = parseKnowledgeBase(knowledgeBase);
    assert.equal(entries.length, 23);
  });

  test('rejects a non-array', () => {
    assert.throws(() => parseKnowledgeBase({}), KnowledgeBaseValidationError);
  });

  test('rejects an empty array', () => {
    assert.throws(() => parseKnowledgeBase([]), KnowledgeBaseValidationError);
  });

  test('rejects an entry with a missing field', () => {
    const { content: _content, ...withoutContent } = validEntry;
    assert.throws(() => parseKnowledgeBase([withoutContent]), /Entry 0 has a missing or empty "content"/);
  });

  test('rejects an entry with an empty field', () => {
    assert.throws(() => parseKnowledgeBase([{ ...validEntry, title: '  ' }]), /"title"/);
  });

  test('rejects a non-https source URL', () => {
    assert.throws(
      () => parseKnowledgeBase([{ ...validEntry, sourceUrl: 'http://www.gov.uk/example' }]),
      /must use https/
    );
  });

  test('rejects an invalid source URL', () => {
    assert.throws(() => parseKnowledgeBase([{ ...validEntry, sourceUrl: 'not a url' }]), /invalid sourceUrl/);
  });
});
