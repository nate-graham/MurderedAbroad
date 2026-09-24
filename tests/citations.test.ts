// Unit tests for lib/citations.ts: server-assigned citation numbers and sources built
// only from cited, approved evidence.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { assignCitationNumbers, renderCitedAnswer } from '@/lib/citations';
import { parseKnowledgeBase } from '@/lib/knowledge-schema';

const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);
const byId = (id: string) => {
  const entry = knowledgeBase.find((item) => item.id === id);
  assert.ok(entry, id);
  return entry;
};

const LAWYERS = 'govuk-lawyers-abroad';
const COSTS = 'govuk-financial-support-and-costs';
const CHARITY_LIMIT = 'ma-financial-support-limitation';

describe('assignCitationNumbers', () => {
  test('numbers several new IDs in one segment in the order they are cited', () => {
    const numbers = assignCitationNumbers([{ text: 'A.', evidenceIds: [LAWYERS, COSTS, CHARITY_LIMIT] }]);
    assert.deepEqual([...numbers], [
      [LAWYERS, 1],
      [COSTS, 2],
      [CHARITY_LIMIT, 3],
    ]);
  });

  test('numbers evidence in order of first use and reuses numbers', () => {
    const numbers = assignCitationNumbers([
      { text: 'A.', evidenceIds: [COSTS] },
      { text: 'B.', evidenceIds: [LAWYERS, COSTS] },
      { text: 'C.', evidenceIds: [LAWYERS] },
    ]);
    assert.deepEqual([...numbers], [
      [COSTS, 1],
      [LAWYERS, 2],
    ]);
  });
});

describe('renderCitedAnswer', () => {
  const selected = [byId(LAWYERS), byId(COSTS), byId(CHARITY_LIMIT)];

  test('adds server citation markers after each segment', () => {
    const { answer } = renderCitedAnswer(
      [
        { text: 'You could consider a local lawyer.', evidenceIds: [LAWYERS] },
        { text: 'The charity cannot fund individual families.', evidenceIds: [CHARITY_LIMIT] },
      ],
      selected
    );
    assert.equal(answer, 'You could consider a local lawyer. [1]\n\nThe charity cannot fund individual families. [2]');
  });

  test('reuses the same number for the same evidence and lists several markers in ascending order', () => {
    const { answer } = renderCitedAnswer(
      [
        { text: 'First.', evidenceIds: [COSTS] },
        { text: 'Second.', evidenceIds: [LAWYERS, COSTS] },
        { text: 'Third.', evidenceIds: [COSTS] },
      ],
      selected
    );
    assert.equal(answer, 'First. [1]\n\nSecond. [1][2]\n\nThird. [1]');
  });

  test('lists only cited evidence, in citation order, with approved metadata', () => {
    const { sources } = renderCitedAnswer([{ text: 'A.', evidenceIds: [CHARITY_LIMIT] }], selected);
    const entry = byId(CHARITY_LIMIT);
    assert.deepEqual(sources, [
      { citation: 1, title: entry.title, sourceName: entry.sourceName, sourceUrl: entry.sourceUrl, category: entry.category },
    ]);
  });

  test('two cited passages from the same publisher both appear', () => {
    const { sources } = renderCitedAnswer(
      [
        { text: 'A.', evidenceIds: [LAWYERS] },
        { text: 'B.', evidenceIds: [COSTS] },
      ],
      selected
    );
    assert.deepEqual(
      sources.map((source) => [source.citation, source.title, source.sourceName]),
      [
        [1, 'Lawyers abroad', 'GOV.UK'],
        [2, 'Financial support and costs', 'GOV.UK'],
      ]
    );
  });

  test('refuses evidence that is not in the selected set', () => {
    assert.throws(() => renderCitedAnswer([{ text: 'A.', evidenceIds: ['ma-contact-support'] }], selected));
  });
});
