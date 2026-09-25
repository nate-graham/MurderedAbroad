// A phone number in model-written answer text must appear in the evidence cited by that
// same segment (Phase 3A). Written before phone validation was added.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { validateGroundedOutput } from '@/lib/grounding';
import { parseKnowledgeBase, type KnowledgeEntry } from '@/lib/knowledge-schema';
import { askChat, groundedContent, mockOpenAI } from './helpers/chat-route';

const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);
const entry = (id: string) => {
  const found = knowledgeBase.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
};

// The only phone number in the corpus, in ma-contact-support.
const APPROVED_PHONE = '0845 123 2384';
const CONTACT = 'ma-contact-support';
const WHO_TO_CONTACT = 'govuk-who-to-contact';
const SELECTED = [entry(WHO_TO_CONTACT), entry(CONTACT)];

type Segment = { text: string; evidenceIds: string[] };

function outcome(segments: Segment[], selected: KnowledgeEntry[] = SELECTED) {
  const result = validateGroundedOutput({ kind: 'content', content: groundedContent(segments), finishReason: 'stop' }, selected);
  return result.outcome === 'rejected' ? `rejected:${result.reason}` : result.outcome;
}

function synthetic(id: string, content: string): KnowledgeEntry {
  return { id, title: 'Synthetic', sourceName: 'Source', sourceUrl: 'https://example.org/', category: 'contact', content };
}

describe('phone numbers in answer text', () => {
  test('the approved helpline from the cited evidence is accepted', () => {
    assert.equal(outcome([{ text: `Call the helpline on ${APPROVED_PHONE}.`, evidenceIds: [CONTACT] }]), 'answered');
  });

  test('an invented helpline is rejected', () => {
    assert.equal(outcome([{ text: 'Call the helpline on 0800 555 0199.', evidenceIds: [CONTACT] }]), 'rejected:uncited-phone');
  });

  test('the approved helpline from a retrieved but uncited passage is rejected', () => {
    assert.equal(
      outcome([{ text: `Call the helpline on ${APPROVED_PHONE}.`, evidenceIds: [WHO_TO_CONTACT] }]),
      'rejected:uncited-phone'
    );
  });

  test('the approved helpline supported only by a different segment rejects the whole answer', () => {
    assert.equal(
      outcome([
        { text: `The charity's helpline is ${APPROVED_PHONE}.`, evidenceIds: [CONTACT] },
        { text: `You can also call ${APPROVED_PHONE}.`, evidenceIds: [WHO_TO_CONTACT] },
      ]),
      'rejected:uncited-phone'
    );
  });

  test('spacing, hyphen and parenthesis variants of the approved number are accepted', () => {
    for (const variant of ['08451232384', '0845-123-2384', '(0845) 123 2384', '0845 1232384']) {
      assert.equal(outcome([{ text: `Call ${variant} for support.`, evidenceIds: [CONTACT] }]), 'answered', variant);
    }
  });

  test('dotted and slash-separated invented numbers are rejected', () => {
    for (const variant of ['0800.555.0199', '0800/555/0199']) {
      assert.equal(outcome([{ text: `Call ${variant} for support.`, evidenceIds: [CONTACT] }]), 'rejected:uncited-phone', variant);
    }
  });

  test('dotted and slash-separated forms of the approved number are accepted', () => {
    for (const variant of ['0845.123.2384', '0845/123/2384']) {
      assert.equal(outcome([{ text: `Call ${variant} for support.`, evidenceIds: [CONTACT] }]), 'answered', variant);
    }
  });

  test('a dotted form of the approved number from an uncited passage is rejected', () => {
    assert.equal(outcome([{ text: 'Call 0845.123.2384 for support.', evidenceIds: [WHO_TO_CONTACT] }]), 'rejected:uncited-phone');
  });

  test('an international-format variant is treated as a different number and rejected', () => {
    assert.equal(outcome([{ text: 'Call +44 845 123 2384 for support.', evidenceIds: [CONTACT] }]), 'rejected:uncited-phone');
  });

  test('an approved number with extra digits is a different number', () => {
    assert.equal(outcome([{ text: 'Call 0845 123 23849 for support.', evidenceIds: [CONTACT] }]), 'rejected:uncited-phone');
  });

  test('every phone number in a segment must be in its cited evidence', () => {
    const twoNumbers = synthetic('synthetic-two-numbers', 'Call 020 7946 0000 or 0161 496 0000.');
    const selected = [twoNumbers];

    assert.equal(outcome([{ text: 'Call 020 7946 0000 or 0161 496 0000.', evidenceIds: [twoNumbers.id] }], selected), 'answered');
    assert.equal(
      outcome([{ text: 'Call 020 7946 0000 or 0113 496 0000.', evidenceIds: [twoNumbers.id] }], selected),
      'rejected:uncited-phone'
    );
  });

  test('harmless numbers are not treated as phone numbers', () => {
    for (const text of [
      'The death happened on 25/09/2026.',
      'The inquest was on 2026-09-25.',
      'The hearing is on 25.09.2026.',
      'Version 1.2.3 of the form, or page 12/34.',
      'Costs may be £12,500.50 or more.',
      'It may take 3 to 6 months, or up to 18 months.',
      'The year 2024 was difficult.',
      'Offices are open 9 to 5, and 24/7 by email.',
    ]) {
      assert.equal(outcome([{ text, evidenceIds: [CONTACT] }]), 'answered', text);
    }
  });
});

describe('route: phone numbers in answers', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_MODEL;
  });

  test('an invented phone number gives the fixed fallback without exposing it', async (t) => {
    const warnings = t.mock.method(console, 'warn', () => {});
    mockOpenAI(t, { content: groundedContent([{ text: 'Call 0800 555 0199 now.', evidenceIds: [CONTACT] }]) });
    const { status, json } = await askChat('Who should I contact if this happened abroad?');

    assert.equal(status, 200);
    assert.equal(json.fallbackUsed, true);
    assert.ok(!JSON.stringify(json).includes('0800 555 0199'));
    assert.deepEqual(warnings.mock.calls[0].arguments, ['Grounded answer not used:', 'uncited-phone']);
  });

  test('the approved helpline cited by its own segment reaches the user', async (t) => {
    mockOpenAI(t, { content: groundedContent([{ text: `Call ${APPROVED_PHONE}.`, evidenceIds: [CONTACT] }]) });
    const { json } = await askChat('Who should I contact if this happened abroad?');

    assert.equal(json.fallbackUsed, false);
    assert.equal(json.answer, `Call ${APPROVED_PHONE}. [1]`);
  });
});
