// Deterministic retrieval evaluation over the 23 approved entries.
// These cases check which approved passages are selected and in what order; they
// make no factual claims beyond the source corpus.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { parseKnowledgeBase } from '@/lib/knowledge-schema';
import { retrieve } from '@/lib/retrieval';

const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);

type SupportedCase = {
  kind: string;
  message: string;
  supported: true;
  // Expected lead passage.
  primary?: string;
  includes?: string[];
  // When true, the selection is exactly `includes` (or just `primary`).
  exactly?: boolean;
  // Evidence that must not be selected.
  excludes?: RegExp;
};

type UnsupportedCase = { kind: string; message: string; supported: false; limitation?: boolean };

type EvaluationCase = SupportedCase | UnsupportedCase;

const cases: EvaluationCase[] = [
  // Singular / plural and inflection variants
  { kind: 'singular', message: 'lawyer', supported: true, primary: 'govuk-lawyers-abroad', exactly: true },
  { kind: 'plural', message: 'lawyers', supported: true, primary: 'govuk-lawyers-abroad', exactly: true },
  { kind: 'plural', message: 'Can I get an interpreter?', supported: true, primary: 'govuk-language-and-interpreters' },
  { kind: 'inflection', message: "How do I repatriate my son's body?", supported: true, primary: 'govuk-repatriation-and-funeral-decisions' },
  // Both passages cover both concepts on their titles with equal scores; corpus order leads.
  { kind: 'inflection', message: 'What does repatriation cost?', supported: true, includes: ['ma-repatriation-advice', 'govuk-financial-support-and-costs'] },
  { kind: 'inflection', message: 'Can I get help with travel costs to attend the trial?', supported: true, primary: 'govuk-financial-support-and-costs' },

  // Synonyms and paraphrases unlike the corpus wording
  { kind: 'synonym', message: 'Do I need a solicitor?', supported: true, primary: 'govuk-lawyers-abroad', exactly: true },
  { kind: 'synonym', message: 'Can the consulate help me?', supported: true, primary: 'govuk-ongoing-consular-support' },
  { kind: 'synonym', message: 'Is an autopsy done after repatriation?', supported: true, primary: 'ma-post-mortem-after-repatriation' },
  { kind: 'synonym', message: 'Will the press contact me?', supported: true, primary: 'govuk-media-attention' },
  { kind: 'synonym', message: 'Will there be an inquest?', supported: true, includes: ['govuk-coroner-after-repatriation', 'ma-coroner-information'], exactly: true },
  { kind: 'synonym', message: 'Does Murdered Abroad give legal advice?', supported: true, primary: 'ma-no-legal-advice-disclaimer' },
  { kind: 'paraphrase', message: "How can I get my loved one's belongings back?", supported: true, primary: 'govuk-repatriation-and-funeral-decisions' },
  { kind: 'paraphrase', message: 'What are my options for burial or cremation?', supported: true, primary: 'govuk-repatriation-and-funeral-decisions' },

  // Short supported questions
  { kind: 'short', message: 'What should I do first?', supported: true, primary: 'govuk-first-steps', exactly: true },
  { kind: 'short', message: 'Can the embassy help me?', supported: true, primary: 'govuk-ongoing-consular-support', exactly: true },
  { kind: 'short', message: 'What does the coroner do?', supported: true, includes: ['govuk-coroner-after-repatriation', 'ma-coroner-information'], exactly: true },
  { kind: 'short', message: 'Is there any financial help?', supported: true, includes: ['govuk-financial-support-and-costs', 'ma-financial-support-limitation'] },
  {
    kind: 'topic from a second passage',
    message: 'Can I get financial support for a funeral?',
    supported: true,
    primary: 'govuk-financial-support-and-costs',
    includes: ['govuk-repatriation-and-funeral-decisions'],
  },
  {
    kind: 'short',
    message: 'Who can help with repatriation?',
    supported: true,
    primary: 'govuk-repatriation-and-funeral-decisions',
    includes: ['ma-repatriation-advice'],
  },

  // Longer natural and conversational questions
  { kind: 'natural', message: 'Who should I contact if this happened abroad?', supported: true, includes: ['govuk-who-to-contact', 'ma-contact-support'], exactly: true },
  { kind: 'natural', message: 'Will the police in England investigate?', supported: true, primary: 'ma-police-in-england-and-wales' },
  { kind: 'natural', message: 'Does Murdered Abroad offer emotional support or counselling?', supported: true, primary: 'ma-emotional-support' },
  { kind: 'natural', message: 'Can the UK government speed up the court case?', supported: true, includes: ['govuk-limits-of-uk-government-power'] },
  { kind: 'natural', message: 'How long will the trial take?', supported: true, includes: ['govuk-limits-of-uk-government-power', 'govuk-court-proceedings-abroad'] },
  { kind: 'natural', message: 'Can I get airport assistance?', supported: true, primary: 'govuk-ongoing-consular-support', exactly: true },
  { kind: 'conversational', message: 'My son died on 3 May 2024, what should I do first?', supported: true, primary: 'govuk-first-steps', exactly: true },
  { kind: 'conversational', message: 'How do I deal with journalists?', supported: true, primary: 'govuk-media-attention', exactly: true },
  { kind: 'conversational', message: 'Is there help with the cost of an interpreter?', supported: true, primary: 'govuk-language-and-interpreters' },
  { kind: 'conversational', message: "I don't speak Spanish, what can I do?", supported: true, primary: 'govuk-language-and-interpreters', exactly: true },
  {
    kind: 'conversational',
    message: 'My brother was killed in Thailand. How can I bring him home?',
    supported: true,
    primary: 'govuk-repatriation-and-funeral-decisions',
  },
  { kind: 'conversational', message: 'Can the charity help me bring my loved one home?', supported: true, primary: 'ma-repatriation-advice' },
  {
    kind: 'conversational',
    message: 'I would really appreciate some guidance about repatriation.',
    supported: true,
    primary: 'govuk-repatriation-and-funeral-decisions',
    excludes: /coroner-information|police|lawyers/,
  },

  // Unsupported questions containing approved-topic words
  { kind: 'two approved words + unknown subject', message: 'Can a lawyer help me claim compensation?', supported: false },
  { kind: 'two approved words + unknown subject', message: 'Is there financial support for school fees?', supported: false },
  { kind: 'two approved words + unknown subject', message: 'Can the coroner help with my divorce?', supported: false },
  { kind: 'capitalised unknown subject', message: 'Can I get financial support for a Mortgage?', supported: false },
  { kind: 'capitalised unknown subject', message: 'Can I get Legal Aid for a lawyer?', supported: false },
  { kind: 'place name', message: 'My daughter died in New Zealand. What should I do first?', supported: true, primary: 'govuk-first-steps' },
  { kind: 'institution alias is not a service', message: 'Can the consulate renew my passport?', supported: false },
  { kind: 'institution alias is not a service', message: 'Can the embassy give me a passport?', supported: false },
  { kind: '"press charges" is not media', message: 'Will the police press charges?', supported: false },
  { kind: 'known word not covered by evidence', message: 'Can the embassy help with insurance?', supported: false },
  { kind: 'keyword collision', message: 'Can the embassy renew my passport?', supported: false },
  { kind: 'keyword collision', message: 'embassy passport', supported: false },
  { kind: 'unsupported', message: 'How do I apply for a visa?', supported: false },
  { kind: 'unsupported', message: 'What is the weather like in Spain?', supported: false },
  { kind: 'corpus-wide term only', message: 'abroad', supported: false },

  // Unresolved references
  { kind: 'contextless follow-up', message: 'How much will that cost?', supported: false },
  { kind: 'actor reference with several concepts', message: 'Will those lawyers speak English?', supported: false },
  { kind: 'actor reference with several concepts', message: 'Can they explain the coroner process?', supported: false },

  // Conservative fallbacks documented as limitations
  { kind: 'lower-case place name', message: 'my brother was killed in thailand how can i bring him home', supported: false, limitation: true },
  { kind: 'wording outside the corpus', message: 'I feel so lost, is there anyone I can talk to?', supported: false, limitation: true },
];

describe('retrieval evaluation', () => {
  for (const evaluationCase of cases) {
    const outcome = evaluationCase.supported ? 'supported' : 'unsupported';
    const prefix = !evaluationCase.supported && evaluationCase.limitation ? 'KNOWN LIMITATION: ' : '';
    const label = `${prefix}[${evaluationCase.kind}] "${evaluationCase.message}" is ${outcome}`;

    test(label, () => {
      const result = retrieve(evaluationCase.message, knowledgeBase);
      const ids = result.matches.map((entry) => entry.id);

      assert.ok(ids.length <= 5, `more than five entries: ${ids.join(', ')}`);

      if (!evaluationCase.supported) {
        assert.equal(result.fallbackUsed, true, `unexpectedly supported by ${ids.join(', ')}`);
        assert.deepEqual(ids, []);
        return;
      }

      assert.equal(result.fallbackUsed, false, `fell back: ${result.fallbackReason}`);
      if (evaluationCase.primary) {
        assert.equal(ids[0], evaluationCase.primary, `lead was ${ids[0]}; selected ${ids.join(', ')}`);
      }
      for (const expectedId of evaluationCase.includes ?? []) {
        assert.ok(ids.includes(expectedId), `expected ${expectedId}, got ${ids.join(', ')}`);
      }
      if (evaluationCase.exactly) {
        const expected = evaluationCase.includes ?? [evaluationCase.primary];
        assert.deepEqual([...ids].sort(), [...expected].sort());
      }
      if (evaluationCase.excludes) {
        for (const id of ids) assert.doesNotMatch(id, evaluationCase.excludes);
      }
    });
  }
});
