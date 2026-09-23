// Regression tests for the precision of the actor/action relationship gate: indirect
// requests, attribution versus performance, compound actions and negation that
// qualifies the relationship. Written before the correction; they describe the
// required behaviour.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { parseKnowledgeBase, type KnowledgeEntry } from '@/lib/knowledge-schema';
import { retrieve } from '@/lib/retrieval';
import { askChat, mockOpenAI } from './helpers/chat-route';

const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);

function ids(message: string, corpus: KnowledgeEntry[] = knowledgeBase) {
  return retrieve(message, corpus).matches.map((entry) => entry.id);
}

function assertFallback(message: string) {
  const result = retrieve(message, knowledgeBase);
  assert.equal(result.fallbackUsed, true, `unexpectedly supported by ${ids(message).join(', ')}`);
  assert.deepEqual(result.matches, []);
}

function assertSupported(message: string, corpus: KnowledgeEntry[] = knowledgeBase) {
  const result = retrieve(message, corpus);
  assert.equal(result.fallbackUsed, false, `unexpected fallback (${result.fallbackReason}) for "${message}"`);
  return result;
}

function limitationFor(message: string, action: string, corpus: KnowledgeEntry[] = knowledgeBase) {
  const evidence = assertSupported(message, corpus).relationship?.evidence.find((item) => item.action === action);
  assert.ok(evidence, `no ${action} evidence for "${message}"`);
  return evidence.limitation;
}

function passage(id: string, content: string): KnowledgeEntry {
  return { id, title: 'Charity support', sourceName: 'Source', sourceUrl: 'https://example.org/', category: 'support', content };
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
});

describe('indirect requests keep the requested actor', () => {
  for (const message of [
    'Can I get the police to pay for my funeral?',
    'How do I get the police to pay for my funeral?',
    'I want the police to pay for my funeral.',
    'Is it possible for the police to pay for my funeral?',
  ]) {
    test(`"${message}" falls back`, () => assertFallback(message));
  }

  test('an indirect request to the charity is answered by its own funding limitation', () => {
    assert.equal(limitationFor('Is it possible for Murdered Abroad to pay for a lawyer?', 'cost'), true);
  });

  test('indirect requests never reach the model', async (t) => {
    const calls = mockOpenAI(t);
    for (const message of ['Can I get the police to pay for my funeral?', 'How do I ask the police to pay for my funeral?']) {
      const { json } = await askChat(message);
      assert.equal(json.fallbackUsed, true, message);
    }
    assert.equal(calls.length, 0);
  });
});

describe('reporting what others do is not performing it', () => {
  test('"Can the charity investigate abroad?" falls back: the charity only reports who should investigate', () => {
    assertFallback('Can the charity investigate abroad?');
  });

  test('"Can Murdered Abroad conduct a post-mortem?" falls back: the charity only says families can request one', () => {
    assertFallback('Can Murdered Abroad conduct a post-mortem?');
  });

  test('a report about another actor still supports that actor ("the charity notes that police ... have no power")', () => {
    assert.equal(limitationFor('Can the police investigate abroad?', 'investigation'), true);
  });

  test('"police force" names the police; it is not a request to force anything', () => {
    const result = assertSupported('Is the UK police force allowed to investigate abroad?');
    assert.deepEqual(result.relationship?.actions, ['investigation']);
    assert.equal(result.matches[0].id, 'ma-police-in-england-and-wales');
  });
});

describe('every requested action must be supported', () => {
  test('"Can the police investigate and pay for repatriation?" falls back: nothing supports police paying', () => {
    assertFallback('Can the police investigate and pay for repatriation?');
  });

  test('a compound request answered for both actions is supported with evidence for each', () => {
    const selected = ids('Does Murdered Abroad provide emotional support or pay for lawyers?');
    assert.ok(selected.includes('ma-emotional-support'), selected.join(', '));
    assert.ok(selected.includes('ma-financial-support-limitation'), selected.join(', '));
  });

  test('a compound request limited for both actions is supported with evidence for each', () => {
    const selected = ids('Can the UK government speed up the trial or force the authorities to share information?');
    assert.ok(selected.includes('govuk-limits-of-uk-government-power'), selected.join(', '));
    assert.ok(selected.includes('govuk-investigation-abroad'), selected.join(', '));
  });
});

describe('a limitation must qualify the requested relationship', () => {
  test('incidental negation elsewhere in the clause is not a limitation', () => {
    const corpus = [passage('incidental', 'The charity provides support to families who do not live in the UK.')];
    assert.equal(limitationFor('Does the charity provide support?', 'provide', corpus), false);
  });

  test('negation between the actor and the action is a limitation', () => {
    const corpus = [passage('limited', 'The charity does not provide support to families.')];
    assert.equal(limitationFor('Does the charity provide support?', 'provide', corpus), true);
  });

  test('approved limiting evidence is still recognised', () => {
    assert.equal(limitationFor('Can Murdered Abroad provide financial support?', 'provide'), true);
    assert.equal(limitationFor('Can the UK government speed up the court case?', 'speed'), true);
    assert.equal(limitationFor('Can the police investigate abroad?', 'investigation'), true);
  });

  test('approved positive evidence is not marked as a limitation', () => {
    assert.equal(limitationFor('Does Murdered Abroad provide emotional support?', 'provide'), false);
    assert.equal(limitationFor('Can the Homicide Service help with repatriation costs?', 'cost'), false);
  });
});
