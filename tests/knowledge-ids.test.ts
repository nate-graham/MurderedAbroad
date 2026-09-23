// Evidence IDs in the checked-in knowledge base.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { loadKnowledgeBase } from '@/lib/knowledge-base';
import { KNOWLEDGE_ENTRY_ID_PATTERN } from '@/lib/knowledge-schema';

const EXPECTED_IDS = [
  'govuk-first-steps',
  'govuk-who-to-contact',
  'govuk-fcdo-case-manager',
  'govuk-ongoing-consular-support',
  'govuk-limits-of-uk-government-power',
  'govuk-language-and-interpreters',
  'govuk-lawyers-abroad',
  'govuk-financial-support-and-costs',
  'govuk-repatriation-and-funeral-decisions',
  'ma-repatriation-advice',
  'govuk-coroner-after-repatriation',
  'ma-coroner-information',
  'ma-post-mortem-after-repatriation',
  'ma-police-in-england-and-wales',
  'govuk-investigation-abroad',
  'govuk-court-proceedings-abroad',
  'govuk-media-attention',
  'ma-practical-support',
  'ma-emotional-support',
  'ma-financial-support-limitation',
  'ma-contact-support',
  'ma-dealing-with-the-fcdo',
  'ma-no-legal-advice-disclaimer',
];

const ID_PREFIX_BY_SOURCE: Record<string, string> = {
  'GOV.UK': 'govuk-',
  'Murdered Abroad Charity': 'ma-',
};

describe('knowledge-base evidence ids', () => {
  test('every one of the 23 entries has an id in the checked-in file', () => {
    assert.equal(knowledgeBaseJson.length, 23);
    for (const entry of knowledgeBaseJson) {
      assert.equal(typeof entry.id, 'string', entry.title);
      assert.notEqual(entry.id.trim(), '', entry.title);
    }
  });

  test('ids are unique', () => {
    const ids = knowledgeBaseJson.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('ids are lowercase kebab-case and prefixed by publisher', () => {
    for (const entry of knowledgeBaseJson) {
      assert.match(entry.id, KNOWLEDGE_ENTRY_ID_PATTERN);
      const prefix = ID_PREFIX_BY_SOURCE[entry.sourceName];
      assert.ok(prefix, `unexpected sourceName ${entry.sourceName}`);
      assert.ok(entry.id.startsWith(prefix), `${entry.id} should start with ${prefix}`);
    }
  });

  test('ids are stable: the exact set and order are pinned', () => {
    assert.deepEqual(
      knowledgeBaseJson.map((entry) => entry.id),
      EXPECTED_IDS
    );
  });

  test('ids survive loading and validation', async () => {
    const entries = await loadKnowledgeBase();
    assert.deepEqual(
      entries.map((entry) => entry.id),
      EXPECTED_IDS
    );
  });
});
