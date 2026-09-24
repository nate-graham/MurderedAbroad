// An email address in model-written answer text must appear verbatim in the evidence
// cited by that same segment. Written before the Phase 2B-2 email correction.
import assert from 'node:assert/strict';
import { beforeEach, describe, test, type TestContext } from 'node:test';
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

// The only approved email address in the corpus, in ma-contact-support.
const APPROVED_EMAIL = 'support@murdered-abroad.org.uk';
const CONTACT = 'ma-contact-support';
const WHO_TO_CONTACT = 'govuk-who-to-contact';
const SELECTED = [entry(WHO_TO_CONTACT), entry(CONTACT)];

type Segment = { text: string; evidenceIds: string[] };

function outcome(segments: Segment[], selected: KnowledgeEntry[] = SELECTED) {
  const result = validateGroundedOutput(
    { kind: 'content', content: groundedContent(segments), finishReason: 'stop' },
    selected
  );
  return result.outcome === 'rejected' ? `rejected:${result.reason}` : result.outcome;
}

function synthetic(id: string, content: string): KnowledgeEntry {
  return { id, title: 'Synthetic', sourceName: 'Source', sourceUrl: 'https://example.org/', category: 'contact', content };
}

describe('email addresses in answer text', () => {
  test('an email address not in the cited evidence is rejected', () => {
    assert.equal(outcome([{ text: 'Email help@evil.example for support.', evidenceIds: [CONTACT] }]), 'rejected:uncited-email');
  });

  test('an approved email address in the cited evidence is accepted', () => {
    assert.equal(outcome([{ text: `Email ${APPROVED_EMAIL} for support.`, evidenceIds: [CONTACT] }]), 'answered');
  });

  test('an approved email address from a retrieved but uncited passage is rejected', () => {
    assert.equal(
      outcome([{ text: `Email ${APPROVED_EMAIL} for support.`, evidenceIds: [WHO_TO_CONTACT] }]),
      'rejected:uncited-email'
    );
  });

  test('an approved email address cited only by a different segment rejects the whole answer', () => {
    assert.equal(
      outcome([
        { text: `The charity can be emailed at ${APPROVED_EMAIL}.`, evidenceIds: [CONTACT] },
        { text: `You can also write to ${APPROVED_EMAIL}.`, evidenceIds: [WHO_TO_CONTACT] },
      ]),
      'rejected:uncited-email'
    );
  });

  test('email matching ignores letter case', () => {
    assert.equal(outcome([{ text: 'Email SUPPORT@Murdered-Abroad.ORG.UK for support.', evidenceIds: [CONTACT] }]), 'answered');
  });

  test('an approved email address followed by punctuation is accepted', () => {
    assert.equal(outcome([{ text: `Contact the charity (${APPROVED_EMAIL}).`, evidenceIds: [CONTACT] }]), 'answered');
  });

  test('every email address in a segment must be in its cited evidence', () => {
    const twoEmails = synthetic('synthetic-two-emails', 'Write to first@example.org or second@example.org.');
    const selected = [twoEmails];

    assert.equal(
      outcome([{ text: 'Write to first@example.org or second@example.org.', evidenceIds: [twoEmails.id] }], selected),
      'answered'
    );
    assert.equal(
      outcome([{ text: 'Write to first@example.org or third@example.org.', evidenceIds: [twoEmails.id] }], selected),
      'rejected:uncited-email'
    );
  });

  test('an email address may come from any of the segment\'s cited passages', () => {
    assert.equal(
      outcome([{ text: `Contact the FCDO or email ${APPROVED_EMAIL}.`, evidenceIds: [WHO_TO_CONTACT, CONTACT] }]),
      'answered'
    );
  });

  test('prose with an @ sign that is not an email address is accepted', () => {
    for (const text of ['Meet a caseworker @ the embassy.', 'The charity is @MurderedAbroad on social media.']) {
      assert.equal(outcome([{ text, evidenceIds: [CONTACT] }]), 'answered', text);
    }
  });
});

describe('route: email addresses in answers', () => {
  const QUESTION = 'Who should I contact if this happened abroad?';

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_MODEL;
  });

  async function ask(t: TestContext, segments: Segment[]) {
    const warnings = t.mock.method(console, 'warn', () => {});
    mockOpenAI(t, { content: groundedContent(segments) });
    const { status, json } = await askChat(QUESTION);
    return { status, json, warnings };
  }

  test('an invented email address gives the fixed fallback without exposing it', async (t) => {
    const { status, json, warnings } = await ask(t, [{ text: 'Email help@evil.example for support.', evidenceIds: [CONTACT] }]);

    assert.equal(status, 200);
    assert.equal(json.fallbackUsed, true);
    assert.ok(!JSON.stringify(json).includes('evil'));
    assert.deepEqual(warnings.mock.calls[0].arguments, ['Grounded answer not used:', 'uncited-email']);
  });

  test('an approved email address cited by its own segment reaches the user', async (t) => {
    const { json } = await ask(t, [{ text: `Email ${APPROVED_EMAIL} for support.`, evidenceIds: [CONTACT] }]);

    assert.equal(json.fallbackUsed, false);
    assert.equal(json.answer, `Email ${APPROVED_EMAIL} for support. [1]`);
    assert.deepEqual(
      json.sources.map((source) => source.title),
      ['How to contact Murdered Abroad Charity']
    );
  });

  test('an approved email address from the retrieved but uncited passage gives the fixed fallback', async (t) => {
    const { json } = await ask(t, [{ text: `Email ${APPROVED_EMAIL} for support.`, evidenceIds: [WHO_TO_CONTACT] }]);
    assert.equal(json.fallbackUsed, true);
  });
});

// Regression tests for two bypasses found in review: "@" text masking a visible domain,
// and an approved address matching as a suffix of a different address.
describe('email tokens are complete, and only real email tokens are masked', () => {
  test('"evil.example/@help" is not an email address, so its domain is still rejected', () => {
    assert.equal(outcome([{ text: 'Visit evil.example/@help for support.', evidenceIds: [CONTACT] }]), 'rejected:metadata-in-text');
  });

  test('an approved address inside a longer address does not authorise it', () => {
    assert.equal(
      outcome([{ text: `Email help!${APPROVED_EMAIL} for support.`, evidenceIds: [CONTACT] }]),
      'rejected:uncited-email'
    );
  });

  // Each probe cites ma-contact-support, which contains only support@murdered-abroad.org.uk.
  const probes: Array<[string, string, string]> = [
    // [text, classification, expected outcome]
    [APPROVED_EMAIL, 'recognised email, approved', 'answered'],
    [APPROVED_EMAIL.toUpperCase(), 'recognised email, approved (case variant)', 'answered'],
    [`${APPROVED_EMAIL},`, 'recognised email with trailing punctuation', 'answered'],
    ['(help@murdered-abroad.org.uk)', 'recognised email, not in cited evidence', 'rejected:uncited-email'],
    [`help!${APPROVED_EMAIL}`, 'recognised email, not in cited evidence', 'rejected:uncited-email'],
    [`prefix.${APPROVED_EMAIL}`, 'recognised email, not in cited evidence', 'rejected:uncited-email'],
    ['evil.example/@help', 'domain-bearing text requiring metadata rejection', 'rejected:metadata-in-text'],
    ['evil.example/@help.example', 'domain-bearing text requiring metadata rejection', 'rejected:metadata-in-text'],
    ['a@b@evil.example', 'domain-bearing text requiring metadata rejection', 'rejected:metadata-in-text'],
    ['@domain.example', 'domain-bearing text requiring metadata rejection', 'rejected:metadata-in-text'],
    ['@MurderedAbroad', 'ordinary @ prose', 'answered'],
    ['name@', 'malformed address-like text without a domain', 'answered'],
  ];

  for (const [probe, classification, expected] of probes) {
    test(`"${probe}" (${classification}) -> ${expected}`, () => {
      assert.equal(outcome([{ text: `Contact: ${probe} today.`, evidenceIds: [CONTACT] }]), expected);
    });
  }
});

describe('route: email-token bypasses give the fixed fallback', () => {
  const QUESTION = 'Who should I contact if this happened abroad?';
  const FALLBACK_ANSWER =
    'I could not find a clear answer in the approved source material.\n\nThe safest next step is to contact Murdered Abroad Charity directly: support@murdered-abroad.org.uk or helpline 0845 123 2384.\n\nYou can also contact the nearest British Embassy, High Commission or Consulate, or local police/authorities in the country involved. If there is immediate danger, contact emergency services immediately.';
  const CONTACT_SOURCE = {
    title: 'How to contact Murdered Abroad Charity',
    sourceName: 'Murdered Abroad Charity',
    sourceUrl: 'https://www.murdered-abroad.org.uk/contact',
    category: 'charity_contact',
  };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_MODEL;
  });

  for (const [text, reason, leaked] of [
    ['Visit evil.example/@help for support.', 'metadata-in-text', 'evil.example'],
    [`Email help!${APPROVED_EMAIL} for support.`, 'uncited-email', 'help!'],
  ]) {
    test(`"${text}" -> ${reason}`, async (t) => {
      const warnings = t.mock.method(console, 'warn', () => {});
      mockOpenAI(t, { content: groundedContent([{ text, evidenceIds: [CONTACT] }]) });
      const { status, json } = await askChat(QUESTION);

      assert.equal(status, 200);
      assert.deepEqual(json, { answer: FALLBACK_ANSWER, sources: [CONTACT_SOURCE], fallbackUsed: true });
      const response = JSON.stringify(json);
      for (const fragment of [leaked, 'for support.', CONTACT, WHO_TO_CONTACT]) {
        assert.ok(!response.includes(fragment), `response leaked ${fragment}`);
      }
      assert.equal(warnings.mock.callCount(), 1);
      assert.deepEqual(warnings.mock.calls[0].arguments, ['Grounded answer not used:', reason]);
    });
  }
});
