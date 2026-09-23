// Direct unit tests for lib/retrieval.ts and lib/retrieval-vocabulary.ts.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import knowledgeBaseJson from '@/data/knowledge-base.json';
import { parseKnowledgeBase, type KnowledgeEntry } from '@/lib/knowledge-schema';
import {
  corpusVocabulary,
  extractConcepts,
  FIELD_WEIGHTS,
  findRelationshipEvidence,
  hasUnresolvedReference,
  rankEntries,
  requiredMatches,
  retrieve,
  selectEvidence,
  subjectActor,
  toConcept,
  tokenize,
} from '@/lib/retrieval';
import {
  ACTION_CONCEPTS,
  ACTOR_CONCEPTS,
  CONCEPT_ALIAS_GROUPS,
  CORPUS_WIDE_CONCEPTS,
  FRAMING_WORDS,
  MODAL_AND_SCOPE_WORDS,
} from '@/lib/retrieval-vocabulary';

const knowledgeBase = parseKnowledgeBase(knowledgeBaseJson);

function entry(overrides: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: 'untitled',
    title: 'Untitled',
    sourceName: 'Source',
    sourceUrl: 'https://example.org/',
    category: 'none',
    content: 'nothing',
    ...overrides,
  };
}

function ids(entries: KnowledgeEntry[]) {
  return entries.map((item) => item.id);
}

describe('tokenize', () => {
  test('lowercases, strips punctuation and removes grammatical stop words and short tokens', () => {
    assert.deepEqual(tokenize('What if I do NOT speak the Language?'), ['not', 'speak', 'language']);
  });

  test('keeps hyphens, splits underscores and dots', () => {
    assert.deepEqual(tokenize('self-harm first_steps GOV.UK'), ['self-harm', 'first', 'steps', 'gov']);
  });

  test('keeps duplicate tokens (de-duplication happens in extractConcepts)', () => {
    assert.deepEqual(tokenize('lawyer lawyer'), ['lawyer', 'lawyer']);
  });

  test('returns no tokens for empty or grammar-only input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize('what should I do?'), []);
    assert.deepEqual(tokenize('How much is that?'), []);
  });

  test('does not stem; word-form variants are handled by curated aliases', () => {
    assert.deepEqual(tokenize('lawyer lawyers'), ['lawyer', 'lawyers']);
  });
});

describe('extractConcepts', () => {
  test('de-duplicates repeated words', () => {
    assert.deepEqual(extractConcepts('lawyer lawyer lawyer lawyer'), ['lawyer']);
  });

  test('maps curated aliases onto one concept', () => {
    assert.deepEqual(extractConcepts('lawyers solicitor solicitors'), ['lawyer']);
    assert.deepEqual(extractConcepts('consulate embassy consular'), ['embassy']);
    assert.deepEqual(extractConcepts('afford pay costs'), ['cost']);
    assert.deepEqual(extractConcepts('inquest coroners'), ['coroner']);
  });

  test('sets aside modal and scope words', () => {
    assert.deepEqual(extractConcepts('Must I appoint a lawyer?'), ['appoint', 'lawyer']);
    assert.deepEqual(extractConcepts('Which lawyer would anyone still need?'), ['lawyer']);
  });

  test('sets aside conversational framing, family relationships and coping verbs', () => {
    assert.deepEqual(
      extractConcepts('I am confused and overwhelmed, please explain how I can find a lawyer.'),
      ['lawyer']
    );
    assert.deepEqual(extractConcepts('I would really appreciate some guidance about repatriation.'), ['repatriation']);
    assert.deepEqual(extractConcepts('How do I deal with journalists?'), ['media']);
  });

  test('sets aside situation words, corpus-wide terms and numbers', () => {
    assert.deepEqual(
      extractConcepts('My sister was killed overseas on 3 May 2024 and I need the first steps.'),
      ['first', 'steps']
    );
    assert.deepEqual(extractConcepts('lawyers abroad'), ['lawyer']);
  });

  test('excludes negation, including split contractions', () => {
    assert.deepEqual(extractConcepts('What if I do not speak the language?'), ['speak', 'language']);
    assert.deepEqual(extractConcepts("I don't speak the language"), ['speak', 'language']);
    assert.deepEqual(extractConcepts('I don’t speak the language'), ['speak', 'language']);
  });

  test('rewrites "bring ... home" to repatriation', () => {
    assert.deepEqual(extractConcepts('How can I bring my brother home?'), ['repatriation']);
    assert.deepEqual(extractConcepts('Can the charity help me bring my loved one home?'), ['charity', 'repatriation']);
  });

  test('"press charges" is not a media question', () => {
    assert.deepEqual(extractConcepts('Will the police press charges?'), ['police', 'press-charges']);
    assert.deepEqual(extractConcepts('Will the press contact me?'), ['media', 'contact']);
  });

  test('keeps first-occurrence order', () => {
    assert.deepEqual(extractConcepts('coroner repatriation coroner'), ['coroner', 'repatriation']);
  });

  test('does not resolve inherited object properties as aliases', () => {
    assert.equal(toConcept('constructor'), 'constructor');
    assert.equal(toConcept('tostring'), 'tostring');
  });
});

describe('vocabulary', () => {
  const vocabulary = corpusVocabulary(knowledgeBase);

  test('every actor and action is a concept in the approved corpus', () => {
    for (const concept of [...ACTOR_CONCEPTS, ...ACTION_CONCEPTS]) {
      assert.ok(vocabulary.known.has(concept), `${concept} does not occur in the corpus`);
    }
  });

  test('every alias target is a concept in the approved corpus', () => {
    for (const concept of Object.keys(CONCEPT_ALIAS_GROUPS)) {
      assert.ok(vocabulary.known.has(concept), `${concept} does not occur in the corpus`);
    }
  });

  test('no word form belongs to more than one alias group', () => {
    const forms = Object.values(CONCEPT_ALIAS_GROUPS).flat();
    assert.equal(new Set(forms).size, forms.length);
  });

  test('no framing or modal word is the topic of any approved passage', () => {
    for (const word of [...FRAMING_WORDS, ...MODAL_AND_SCOPE_WORDS]) {
      assert.ok(!vocabulary.topics.has(toConcept(word)), `"${word}" is a passage topic and must not be set aside`);
    }
  });

  test('corpus-wide concepts appear in at least three quarters of entries', () => {
    for (const concept of CORPUS_WIDE_CONCEPTS) {
      const count = knowledgeBase.filter((item) =>
        tokenize(`${item.title} ${item.category} ${item.content}`).map(toConcept).includes(concept)
      ).length;
      assert.ok(count >= knowledgeBase.length * 0.75, `${concept} appears in only ${count} entries`);
    }
  });
});

describe('names', () => {
  test('recognised country names are removed, including multi-word names', () => {
    assert.deepEqual(extractConcepts('My son was killed in France. What should I do first?'), ['first']);
    assert.deepEqual(extractConcepts('killed in Papua New Guinea or New Zealand'), []);
  });

  test('a capitalised language after "speak" is removed', () => {
    assert.deepEqual(extractConcepts("I don't speak Spanish"), ['speak']);
  });

  test('other capitalised words are not treated as names', () => {
    assert.deepEqual(extractConcepts('Can I get support from Legal Aid?'), ['support', 'legal', 'aid']);
    assert.deepEqual(extractConcepts('Can I get financial support in Mortgage?'), ['cost', 'support', 'mortgage']);
  });

  test('KNOWN LIMITATION: lower-case country names and cities are not recognised', () => {
    assert.deepEqual(extractConcepts('killed in thailand'), ['thailand']);
    assert.deepEqual(extractConcepts('killed in Bangkok'), ['bangkok']);
  });
});

describe('charity identity and repatriation phrases', () => {
  test('"Murdered Abroad" by name is the charity; lower-case "murdered abroad" is the situation', () => {
    assert.deepEqual(extractConcepts('Can Murdered Abroad help with repatriation?'), ['charity', 'repatriation']);
    assert.deepEqual(extractConcepts('What should I do first after my father was murdered abroad?'), ['first']);
  });

  test('"after repatriation" is a distinct concept from repatriation', () => {
    assert.deepEqual(extractConcepts('What happens after repatriation?'), ['after-repatriation']);
    assert.deepEqual(extractConcepts('repatriation'), ['repatriation']);
  });

  test('a title crediting the charity ("... from Murdered Abroad") is not about the charity', () => {
    const credited = entry({ id: 'credited', title: 'Repatriation advice from Murdered Abroad' });
    const about = entry({ id: 'about', title: 'Murdered Abroad practical support' });

    assert.deepEqual(rankEntries(['charity'], [credited, about]).map((ranked) => ranked.entry.id), ['about']);
  });
});

describe('requiredMatches (strict majority of concepts)', () => {
  test('requires more than half of the concepts', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map(requiredMatches),
      [1, 2, 2, 3, 3]
    );
  });
});

describe('hasUnresolvedReference', () => {
  test('actor pronouns are unresolved regardless of the number of concepts', () => {
    assert.equal(hasUnresolvedReference('Can they help with repatriation?', ['repatriation']), true);
    assert.equal(hasUnresolvedReference('Can they pay repatriation costs?', ['cost', 'repatriation']), true);
    assert.equal(hasUnresolvedReference('Will those lawyers speak English?', ['lawyer', 'speak', 'english']), true);
  });

  test('a demonstrative with at most one concept is unresolved', () => {
    assert.equal(hasUnresolvedReference('How much will that cost?', ['cost']), true);
    assert.equal(hasUnresolvedReference('How much will it cost?', ['cost']), true);
    assert.equal(hasUnresolvedReference('How much will this cost?', ['cost']), true);
  });

  test('a demonstrative referring to the situation ("this happened") is resolved', () => {
    assert.equal(hasUnresolvedReference('Who should I contact if this happened abroad?', ['contact']), false);
    assert.equal(hasUnresolvedReference('Who do I contact if it has happened abroad?', ['contact']), false);
  });

  test('KNOWN LIMITATION: the conjunction "now that" leaves a bare demonstrative and falls back', () => {
    assert.equal(hasUnresolvedReference('Who do I contact now that it has happened?', ['contact']), true);
  });

  test('a demonstrative in a question that names its own topics is resolved', () => {
    assert.equal(hasUnresolvedReference('What does it cost to repatriate a body?', ['cost', 'repatriation', 'body']), false);
  });

  test('no reference word means no unresolved reference', () => {
    assert.equal(hasUnresolvedReference('lawyer', ['lawyer']), false);
  });
});

describe('subjectActor', () => {
  test('finds the actor after the auxiliary verb, skipping articles and modifiers', () => {
    assert.equal(subjectActor('Can the local police pay for my funeral?'), 'police');
    assert.equal(subjectActor('Does Murdered Abroad provide money for a lawyer?'), 'charity');
    assert.equal(subjectActor('Can a solicitor conduct a post-mortem?'), 'lawyer');
    assert.equal(subjectActor('Will the press contact me?'), 'media');
    assert.equal(subjectActor('Can the UK government speed up the court case?'), 'government');
    assert.equal(subjectActor('What practical support does Murdered Abroad provide?'), 'charity');
  });

  test('finds the actor in "get/ask <actor> to" requests', () => {
    assert.equal(subjectActor('Can I get the police to pay for my funeral?'), 'police');
    assert.equal(subjectActor('How do I ask the embassy to investigate?'), 'embassy');
  });

  test('returns null when the subject is not an actor', () => {
    assert.equal(subjectActor('Who will pay for a lawyer?'), null);
    assert.equal(subjectActor('Can I get financial support for a funeral?'), null);
    assert.equal(subjectActor('Must I appoint a lawyer?'), null);
    assert.equal(subjectActor('Can I get the police report?'), null);
    assert.equal(subjectActor('lawyer'), null);
  });
});

describe('findRelationshipEvidence', () => {
  function evidenceFor(actor: string, actions: string[], entries: KnowledgeEntry[]) {
    return findRelationshipEvidence(actor, actions, rankEntries([actor, ...actions], entries)).map(
      ({ action, entryId, limitation }) => ({ action, entryId, limitation })
    );
  }

  test('finds the charity\'s own statement that it cannot provide financial support', () => {
    assert.deepEqual(evidenceFor('charity', ['cost'], knowledgeBase), [
      { action: 'cost', entryId: 'ma-financial-support-limitation', limitation: true },
    ]);
  });

  test('finds positive evidence without a limitation', () => {
    assert.deepEqual(evidenceFor('homicide', ['cost'], knowledgeBase), [
      { action: 'cost', entryId: 'govuk-financial-support-and-costs', limitation: false },
    ]);
  });

  test('returns evidence per action and omits actions without evidence', () => {
    assert.deepEqual(
      evidenceFor('police', ['investigation', 'cost'], knowledgeBase).map((item) => item.action),
      ['investigation']
    );
  });

  test('the actor and action must share a clause, not just a sentence', () => {
    const sameSentence = entry({ id: 'list', content: 'Help meeting investigating authorities, and advice on media interest.' });
    assert.deepEqual(evidenceFor('media', ['investigation'], [sameSentence]), []);

    const sameClause = entry({ id: 'clause', content: 'The media cannot investigate crimes.' });
    assert.deepEqual(evidenceFor('media', ['investigation'], [sameClause]), [
      { action: 'investigation', entryId: 'clause', limitation: true },
    ]);
  });

  test('a reporter performs only what it reports about itself', () => {
    const reportsOthers = entry({ id: 'others', content: 'The charity says the police should investigate.' });
    assert.deepEqual(evidenceFor('charity', ['investigation'], [reportsOthers]), []);
    assert.deepEqual(evidenceFor('police', ['investigation'], [reportsOthers]), [
      { action: 'investigation', entryId: 'others', limitation: false },
    ]);

    const reportsItself = entry({ id: 'itself', content: 'The charity says it investigates complaints.' });
    assert.deepEqual(evidenceFor('charity', ['investigation'], [reportsItself]), [
      { action: 'investigation', entryId: 'itself', limitation: false },
    ]);
  });

  test('an actor after a preposition is an object, not the performer', () => {
    const object = entry({ id: 'object', content: 'Help arranging a meeting with local police to investigate.' });
    assert.deepEqual(evidenceFor('police', ['investigation'], [object]), []);
  });

  test('the performer must come before the action', () => {
    const passive = entry({ id: 'passive', content: 'Deaths are investigated by the police.' });
    assert.deepEqual(evidenceFor('police', ['investigation'], [passive]), []);

    const actionFirst = entry({ id: 'action-first', content: 'Investigations abroad concern the police.' });
    assert.deepEqual(evidenceFor('police', ['investigation'], [actionFirst]), []);
  });
});

describe('rankEntries', () => {
  test('scores each distinct concept once per field; the publisher is not scored', () => {
    const sample = entry({ title: 'Gamma title', category: 'gamma', sourceName: 'Gamma Publisher', content: 'gamma gamma' });
    const [ranked] = rankEntries(['gamma'], [sample]);

    assert.equal(ranked.score, FIELD_WEIGHTS.title + FIELD_WEIGHTS.category + FIELD_WEIGHTS.content);
    assert.deepEqual(ranked.topicMatches, ['gamma']);
    assert.deepEqual(rankEntries(['publisher'], [sample]), []);
  });

  test('a passage about more of the question outranks one about less', () => {
    const one = entry({ id: 'one', title: 'alpha', category: 'alpha' });
    const both = entry({ id: 'both', category: 'beta', content: 'alpha' });

    assert.deepEqual(
      rankEntries(['alpha', 'beta'], [one, both]).map((ranked) => ranked.entry.id),
      ['both', 'one']
    );
  });

  test('a strong topical passage outranks a passage that only mentions more concepts', () => {
    const topical = entry({ id: 'topical', title: 'alpha' });
    const scattered = entry({ id: 'scattered', content: 'alpha words beta words gamma' });

    assert.deepEqual(
      rankEntries(['alpha', 'beta', 'gamma'], [scattered, topical]).map((ranked) => ranked.entry.id),
      ['topical', 'scattered']
    );
  });

  test('breaks ties by knowledge-base order', () => {
    const tieA = entry({ id: 'tie-a', category: 'alpha' });
    const tieB = entry({ id: 'tie-b', category: 'alpha' });

    assert.deepEqual(
      rankEntries(['alpha'], [tieB, tieA]).map((ranked) => ranked.entry.id),
      ['tie-b', 'tie-a']
    );
  });

  test('detects the question phrase side by side in passage text', () => {
    const phrase = entry({ id: 'phrase', content: 'costs such as legal advice' });
    const scattered = entry({ id: 'scattered', content: 'legal process and separate advice' });
    const [first, second] = rankEntries(['legal', 'advice'], [phrase, scattered]);

    assert.equal(first.phraseMatch, true);
    assert.equal(second.phraseMatch, false);
  });

  test('omits entries that match no concept', () => {
    assert.deepEqual(rankEntries(['alpha'], [entry({})]), []);
  });
});

describe('selectEvidence', () => {
  test('adds a passage whose title or category covers a topic concept the lead lacks', () => {
    const lead = entry({ id: 'lead', title: 'alpha', category: 'alpha' });
    const betaTopic = entry({ id: 'beta-topic', title: 'beta' });
    const ranked = rankEntries(['alpha', 'beta'], [lead, betaTopic]);

    assert.deepEqual(ids(selectEvidence(ranked, ['alpha', 'beta']).map((item) => item.entry)), ['lead', 'beta-topic']);
  });

  test('keeps complementary passages that use the question phrase and drops scattered mentions', () => {
    const lead = entry({ id: 'lead', title: 'legal advice' });
    const phrase = entry({ id: 'phrase', content: 'help with legal advice costs' });
    const scattered = entry({ id: 'scattered', content: 'legal process and separate advice' });
    const ranked = rankEntries(['legal', 'advice'], [scattered, phrase, lead]);

    assert.deepEqual(ids(selectEvidence(ranked, ['legal', 'advice']).map((item) => item.entry)), ['lead', 'phrase']);
  });

  test('a passing single-concept mention does not accompany a topical lead', () => {
    const lead = entry({ id: 'lead', title: 'gamma', category: 'gamma' });
    const mention = entry({ id: 'mention', content: 'gamma' });
    const ranked = rankEntries(['gamma'], [mention, lead]);

    assert.deepEqual(ids(selectEvidence(ranked, ['gamma']).map((item) => item.entry)), ['lead']);
  });

  test('being about the question actor alone does not make a passage complementary', () => {
    const lead = entry({ id: 'lead', title: 'charity practical support', content: 'provide' });
    const sameActor = entry({ id: 'same-actor', title: 'charity and others', content: 'practical steps, support needs, provide lists' });
    const ranked = rankEntries(['charity', 'practical', 'support', 'provide'], [sameActor, lead]);

    assert.deepEqual(
      ids(selectEvidence(ranked, ['charity', 'practical', 'support'], [], 'charity').map((item) => item.entry)),
      ['lead']
    );
  });

  test('always includes the required relationship evidence', () => {
    const lead = entry({ id: 'lead', title: 'alpha', category: 'alpha' });
    const evidence = entry({ id: 'evidence', content: 'alpha words' });
    const ranked = rankEntries(['alpha'], [lead, evidence]);

    assert.deepEqual(ids(selectEvidence(ranked, ['alpha'], [ranked[1]]).map((item) => item.entry)), ['lead', 'evidence']);
  });

  test('never selects more than five passages', () => {
    const entries = Array.from({ length: 7 }, (_, index) => entry({ id: `entry-${index}`, title: 'gamma' }));
    const ranked = rankEntries(['gamma'], entries);

    assert.deepEqual(
      ids(selectEvidence(ranked, ['gamma']).map((item) => item.entry)),
      ['entry-0', 'entry-1', 'entry-2', 'entry-3', 'entry-4']
    );
  });
});

describe('retrieve fallback reasons', () => {
  test('no topical concepts', () => {
    const result = retrieve('I do not know what to do', knowledgeBase);
    assert.equal(result.fallbackReason, 'no-topical-concepts');
    assert.deepEqual(result.matches, []);
  });

  test('unresolved reference', () => {
    const result = retrieve('How much will that cost?', knowledgeBase);
    assert.equal(result.fallbackReason, 'unresolved-reference');
    assert.deepEqual(result.queryConcepts, ['cost']);
  });

  test('unsupported concept: a subject absent from the corpus is decisive', () => {
    const result = retrieve('Can I get financial support for a mortgage?', knowledgeBase);
    assert.equal(result.fallbackReason, 'unsupported-concept');
    assert.deepEqual(result.queryConcepts, ['cost', 'support', 'mortgage']);
    assert.deepEqual(result.unsupportedConcepts, ['mortgage']);
    assert.deepEqual(result.selected, []);
  });

  test('weak match: a single passing mention in body text', () => {
    const result = retrieve('belongings', knowledgeBase);
    assert.equal(result.fallbackReason, 'weak-match');
  });

  test('unsupported relationship: no approved clause names the actor with the action', () => {
    const result = retrieve('Can the police pay for my funeral?', knowledgeBase);
    assert.equal(result.fallbackReason, 'unsupported-relationship');
    assert.deepEqual(result.queryConcepts, ['police', 'cost', 'funeral']);
    assert.deepEqual(result.matches, []);
  });

  test('insufficient coverage: the selected evidence does not cover the question', () => {
    const result = retrieve('Can the embassy help with insurance?', knowledgeBase);
    assert.equal(result.fallbackReason, 'insufficient-coverage');
    assert.deepEqual(result.uncoveredConcepts, ['insurance']);
  });

  test('insufficient coverage: a topic concept left uncovered because of the five-passage limit', () => {
    const topics = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
    const entries = topics.map((topic) => entry({ id: topic, title: topic }));
    const result = retrieve(topics.join(' '), entries);

    // Five of six concepts are covered (a strict majority), but a named topic is not.
    assert.equal(result.fallbackReason, 'insufficient-coverage');
    assert.deepEqual(result.uncoveredConcepts, ['zeta']);
  });

  test('empty corpus: every concept is unsupported', () => {
    assert.equal(retrieve('lawyer', []).fallbackReason, 'unsupported-concept');
  });
});

describe('retrieve support', () => {
  test('country names are not treated as unsupported subjects', () => {
    const result = retrieve('My brother was killed in Thailand. How can I bring him home?', knowledgeBase);
    assert.equal(result.fallbackUsed, false);
    assert.deepEqual(result.queryConcepts, ['repatriation']);
    assert.equal(result.matches[0].id, 'govuk-repatriation-and-funeral-decisions');
  });

  test('reports limiting relationship evidence and includes it', () => {
    const result = retrieve('Can Murdered Abroad pay for a lawyer?', knowledgeBase);
    assert.equal(result.relationship?.actor, 'charity');
    assert.deepEqual(
      result.relationship?.evidence.map(({ action, entryId, limitation }) => ({ action, entryId, limitation })),
      [{ action: 'cost', entryId: 'ma-financial-support-limitation', limitation: true }]
    );
    assert.ok(result.matches.some((item) => item.id === 'ma-financial-support-limitation'));
  });

  test('capitalising an unsupported subject does not make it supported', () => {
    for (const message of ['Can I get financial support for a Mortgage?', 'Can I get Legal Aid for a lawyer?']) {
      const result = retrieve(message, knowledgeBase);
      assert.equal(result.fallbackReason, 'unsupported-concept', message);
    }
  });

  test('KNOWN LIMITATION: a person\'s name is treated as an unsupported subject', () => {
    const result = retrieve('My son John was killed. What should I do first?', knowledgeBase);
    assert.equal(result.fallbackReason, 'unsupported-concept');
    assert.deepEqual(result.unsupportedConcepts, ['john']);
  });

  test('selected diagnostics match the returned entries', () => {
    const result = retrieve('What does the coroner do?', knowledgeBase);

    assert.equal(result.fallbackReason, null);
    assert.deepEqual(
      result.selected.map((ranked) => ranked.entry),
      result.matches
    );
    assert.deepEqual(
      result.selected.map((ranked) => [ranked.entry.id, ranked.matchedConcepts, ranked.score]),
      [
        ['govuk-coroner-after-repatriation', ['coroner'], 10],
        ['ma-coroner-information', ['coroner'], 10],
      ]
    );
  });
});
