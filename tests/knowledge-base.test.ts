// Direct unit tests for lib/knowledge-base.ts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { loadKnowledgeBase } from '@/lib/knowledge-base';

describe('loadKnowledgeBase', () => {
  test('loads the checked-in corpus unchanged by validation', async () => {
    const raw = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'knowledge-base.json'), 'utf8'));
    assert.deepEqual(await loadKnowledgeBase(), raw);
  });

  test('contains 23 entries: 13 GOV.UK and 10 Murdered Abroad Charity', async () => {
    const entries = await loadKnowledgeBase();
    const count = (sourceName: string) => entries.filter((entry) => entry.sourceName === sourceName).length;

    assert.equal(entries.length, 23);
    assert.equal(count('GOV.UK'), 13);
    assert.equal(count('Murdered Abroad Charity'), 10);
  });
});
