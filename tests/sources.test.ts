// Direct unit tests for lib/sources.ts. KNOWN WEAKNESS cases are expected to
// change when citations are reworked.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { KnowledgeEntry } from '@/lib/knowledge-schema';
import { buildSources } from '@/lib/sources';

function entry(title: string, sourceName: string): KnowledgeEntry {
  return {
    id: title,
    title,
    sourceName,
    sourceUrl: `https://example.org/${title}`,
    category: `${title}-category`,
    content: `${title} content`,
  };
}

describe('buildSources', () => {
  test('returns title, source name, URL and category without content', () => {
    assert.deepEqual(buildSources([entry('a', 'GOV.UK')]), [
      { title: 'a', sourceName: 'GOV.UK', sourceUrl: 'https://example.org/a', category: 'a-category' },
    ]);
  });

  test('returns an empty list for no matches', () => {
    assert.deepEqual(buildSources([]), []);
  });

  test('KNOWN WEAKNESS: keeps only the first entry per source name', () => {
    const sources = buildSources([
      entry('a', 'GOV.UK'),
      entry('b', 'Murdered Abroad Charity'),
      entry('c', 'GOV.UK'),
      entry('d', 'Murdered Abroad Charity'),
    ]);

    assert.deepEqual(
      sources.map((source) => source.title),
      ['a', 'b']
    );
  });
});
