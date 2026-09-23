// Deterministic retrieval over the approved knowledge base.
//
// Topic concepts: a question is reduced to distinct topical concepts. Country and
// language names, grammar, modal and scope words, conversational framing, situation
// words, negation and corpus-wide words are set aside; curated aliases and phrases map
// word forms onto one concept.
//
// Answerability (any failure -> fixed fallback):
//   - the question has at least one concept and no unresolved reference;
//   - every concept occurs somewhere in the approved corpus (an unknown subject such
//     as "mortgage" is decisive);
//   - when the question asks an actor (its subject, or the actor in "get/ask X to") to
//     perform actions, an approved clause states that the actor performs, or cannot
//     perform, each one; reporting what others do is not performing it;
//   - the lead passage matches on its title/category or on two or more concepts;
//   - the selected evidence covers every concept the corpus treats as a topic and a
//     strict majority of all concepts.
//
// Selection: the highest-scoring passage leads; the evidence for every actor/action
// pair is always included; passages are added to cover topic concepts the selection misses, then
// complementary passages that match as many concepts as the lead and are about them
// (title/category, the question's own phrase, or an equal score). At most five.
import type { KnowledgeEntry } from '@/lib/knowledge-schema';
import { COUNTRY_NAME_PATTERN } from '@/lib/place-names';
import {
  ACTION_CONCEPTS,
  ACTOR_CONCEPTS,
  ACTOR_REFERENCE_WORDS,
  CONCEPT_ALIAS_GROUPS,
  CORPUS_WIDE_CONCEPTS,
  DEMONSTRATIVE_REFERENCE_WORDS,
  FRAMING_WORDS,
  LIMITATION_WORDS,
  MODAL_AND_SCOPE_WORDS,
  NEGATION_TOKENS,
  OBJECT_PREPOSITIONS,
  PHRASE_ALIASES,
  REPORTING_VERBS,
  REQUEST_VERBS,
  SELF_REFERENCE_WORDS,
  SITUATION_REFERENCE_PATTERN,
  SITUATION_WORDS,
  STOP_WORDS,
  SUBJECT_AUXILIARIES,
  SUBJECT_MODIFIERS,
  TITLE_ATTRIBUTION_PATTERN,
} from '@/lib/retrieval-vocabulary';

export const MAX_CONTEXT_ENTRIES = 5;

// A demonstrative ("it", "this", "that") with this many topic concepts or fewer is
// treated as pointing back to an earlier message.
export const MAX_CONCEPTS_FOR_DEMONSTRATIVE_REFERENCE = 1;

// Points for each distinct question concept found in a field. The publisher name is not
// scored: it identifies who wrote a passage, not what it is about.
export const FIELD_WEIGHTS = {
  title: 5,
  category: 4,
  content: 1,
} as const;

export type RetrievalFallbackReason =
  | 'no-topical-concepts'
  | 'unresolved-reference'
  | 'unsupported-concept'
  | 'unsupported-relationship'
  | 'weak-match'
  | 'insufficient-coverage';

export type RankedEntry = {
  entry: KnowledgeEntry;
  // Question concepts found anywhere in the passage.
  matchedConcepts: string[];
  // Question concepts found in the passage's title or category.
  topicMatches: string[];
  // True when two of the question's concepts appear side by side in the passage text
  // (e.g. "legal advice"), rather than merely somewhere in it.
  phraseMatch: boolean;
  score: number;
};

// An approved clause stating that the actor performs (or cannot perform) one action.
export type ActionEvidence = {
  action: string;
  entryId: string;
  clause: string;
  // True when negation between the actor and the action states a limitation.
  limitation: boolean;
};

// The actor a question asks about, every action it asks that actor to perform, and the
// evidence found for each. Actions without evidence have no entry in `evidence`.
export type RelationshipEvidence = {
  actor: string;
  actions: string[];
  evidence: ActionEvidence[];
};

export type RetrievalResult = {
  queryConcepts: string[];
  // Concepts that occur nowhere in the approved corpus.
  unsupportedConcepts: string[];
  // Present when the question asks whether an actor performs one or more actions.
  relationship: RelationshipEvidence | null;
  // Question concepts not covered by the selected evidence (diagnostic).
  uncoveredConcepts: string[];
  // Selected passages with diagnostics, lead first. Empty when fallbackUsed is true.
  selected: RankedEntry[];
  // The selected knowledge entries, lead first. Empty when fallbackUsed is true.
  matches: KnowledgeEntry[];
  fallbackUsed: boolean;
  fallbackReason: RetrievalFallbackReason | null;
};

const conceptByWordForm = new Map<string, string>(
  Object.entries(CONCEPT_ALIAS_GROUPS).flatMap(([concept, forms]) => forms.map((form) => [form, concept] as const))
);

function applyPhraseAliases(text: string) {
  return PHRASE_ALIASES.reduce((current, { pattern, replacement }) => current.replace(pattern, replacement), text);
}

export function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function toConcept(token: string) {
  return conceptByWordForm.get(token) ?? token;
}

function isFramingToken(token: string) {
  return (
    MODAL_AND_SCOPE_WORDS.has(token) ||
    FRAMING_WORDS.has(token) ||
    SITUATION_WORDS.has(token) ||
    NEGATION_TOKENS.has(token) ||
    /^\d+$/.test(token)
  );
}

// Country names (curated list) and a capitalised language after "speak" ("I don't
// speak Spanish") say where or how, not what about. Removed before tokenising.
export function removeNames(text: string) {
  return text.replace(COUNTRY_NAME_PATTERN, ' ').replace(/\b(speak|speaks|speaking)\s+[A-Z][a-z]+\b/g, '$1 ');
}

// Distinct topical concepts of a question, in first-occurrence order.
export function extractConcepts(text: string): string[] {
  const concepts = tokenize(applyPhraseAliases(removeNames(text)))
    .filter((token) => !isFramingToken(token))
    .map(toConcept)
    .filter((concept) => !CORPUS_WIDE_CONCEPTS.has(concept));
  return [...new Set(concepts)];
}

// Concepts of a knowledge-entry field, in text order. Only grammatical stop words are removed.
function fieldConceptSequence(text: string) {
  return tokenize(applyPhraseAliases(text)).map(toConcept);
}

function fieldConcepts(text: string) {
  return new Set(fieldConceptSequence(text));
}

function titleText(entry: KnowledgeEntry) {
  return entry.title.replace(TITLE_ATTRIBUTION_PATTERN, ' ');
}

function adjacentPairs(concepts: string[]) {
  const pairs = new Set<string>();
  for (let index = 1; index < concepts.length; index += 1) {
    pairs.add(`${concepts[index - 1]} ${concepts[index]}`);
    pairs.add(`${concepts[index]} ${concepts[index - 1]}`);
  }
  return pairs;
}


export function hasUnresolvedReference(message: string, queryConcepts: string[]) {
  const words = message.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.some((word) => ACTOR_REFERENCE_WORDS.has(word))) return true;

  if (queryConcepts.length > MAX_CONCEPTS_FOR_DEMONSTRATIVE_REFERENCE) return false;
  const withoutSituation = message.replace(new RegExp(SITUATION_REFERENCE_PATTERN, 'gi'), ' ');
  const remaining = withoutSituation.toLowerCase().match(/[a-z]+/g) ?? [];
  return remaining.some((word) => DEMONSTRATIVE_REFERENCE_WORDS.has(word));
}

// Strict majority: 1 of 1, 2 of 2, 2 of 3, 3 of 4, 3 of 5.
export function requiredMatches(conceptCount: number) {
  return Math.floor(conceptCount / 2) + 1;
}

type CorpusVocabulary = {
  // Every concept that occurs anywhere in an entry's title, category or content.
  known: Set<string>;
  // Concepts that occur in some entry's title or category.
  topics: Set<string>;
};

export function corpusVocabulary(entries: KnowledgeEntry[]): CorpusVocabulary {
  const known = new Set<string>();
  const topics = new Set<string>();
  for (const entry of entries) {
    for (const concept of [...fieldConcepts(titleText(entry)), ...fieldConcepts(entry.category)]) {
      known.add(concept);
      topics.add(concept);
    }
    for (const concept of fieldConcepts(entry.content)) {
      known.add(concept);
    }
  }
  return { known, topics };
}

// Entries matching at least one concept. Passages about a question concept (title or
// category match) come first, then those matching more concepts, then higher score,
// then knowledge-base order. A passage that only mentions several concepts in passing
// cannot outrank one that is about them.
export function rankEntries(queryConcepts: string[], entries: KnowledgeEntry[]): RankedEntry[] {
  const queryPairs = adjacentPairs(queryConcepts);

  return entries
    .map((entry, index) => {
      const title = fieldConcepts(titleText(entry));
      const category = fieldConcepts(entry.category);
      const contentSequence = fieldConceptSequence(entry.content);
      const content = new Set(contentSequence);
      const contentPairs = adjacentPairs(contentSequence);
      const phraseMatch = [...queryPairs].some((pair) => contentPairs.has(pair));

      let score = 0;
      const matchedConcepts: string[] = [];
      const topicMatches: string[] = [];
      for (const concept of queryConcepts) {
        const conceptScore =
          (title.has(concept) ? FIELD_WEIGHTS.title : 0) +
          (category.has(concept) ? FIELD_WEIGHTS.category : 0) +
          (content.has(concept) ? FIELD_WEIGHTS.content : 0);
        if (conceptScore === 0) continue;
        matchedConcepts.push(concept);
        if (title.has(concept) || category.has(concept)) topicMatches.push(concept);
        score += conceptScore;
      }

      return { index, ranked: { entry, matchedConcepts, topicMatches, phraseMatch, score } };
    })
    .filter(({ ranked }) => ranked.matchedConcepts.length > 0)
    .sort(
      (a, b) =>
        Number(b.ranked.topicMatches.length > 0) - Number(a.ranked.topicMatches.length > 0) ||
        b.ranked.matchedConcepts.length - a.ranked.matchedConcepts.length ||
        b.ranked.score - a.ranked.score ||
        a.index - b.index
    )
    .map(({ ranked }) => ranked);
}

function words(text: string) {
  return (applyPhraseAliases(text).match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).map((word) => word.toLowerCase());
}

// The first word from `start` that is not an article or simple modifier, as an actor
// concept, with its position; null when that word is not an actor.
function actorAt(wordList: string[], start: number): { actor: string; index: number } | null {
  let index = start;
  while (index < wordList.length && SUBJECT_MODIFIERS.has(wordList[index])) index += 1;
  if (index >= wordList.length) return null;
  const concept = toConcept(wordList[index]);
  return ACTOR_CONCEPTS.has(concept) ? { actor: concept, index } : null;
}

// The actor a question asks to do something:
//   - the grammatical subject after the first auxiliary verb ("Can the local police
//     pay ...", "Does Murdered Abroad provide ...");
//   - otherwise the actor in "<introducer> [the] <actor> to ..." ("Can I get the police
//     to pay ...", "I want the police to pay ...", "possible for the police to pay ...").
// Null when there is no such actor ("Who will pay ...", "Can I get support ...").
export function subjectActor(message: string): string | null {
  const wordList = words(message);

  const auxiliaryIndex = wordList.findIndex((word) => SUBJECT_AUXILIARIES.has(word));
  if (auxiliaryIndex >= 0) {
    const subject = actorAt(wordList, auxiliaryIndex + 1);
    if (subject) return subject.actor;
  }

  for (let index = 0; index < wordList.length; index += 1) {
    if (!REQUEST_VERBS.has(wordList[index])) continue;
    const requested = actorAt(wordList, index + 1);
    if (requested && wordList[requested.index + 1] === 'to') return requested.actor;
  }
  return null;
}

// Each comma-, semicolon-, colon- or full-stop-separated clause of the passage content.
// Titles are topic labels, not statements, so they are not relationship evidence.
function passageClauses(entry: KnowledgeEntry) {
  return entry.content.split(/[.,;:]/).filter((clause) => clause.trim() !== '');
}

// Positions in a clause where the actor performs, rather than reports or receives:
//   - after a reporting verb, the report's own subject is the performer, and a reporter
//     performs only when the report is about itself ("Murdered Abroad says it provides");
//   - an actor directly after a preposition is an object ("a meeting with local police").
function performerPositions(clauseWords: string[], actor: string) {
  const reportIndex = clauseWords.findIndex((word) => REPORTING_VERBS.has(word));
  const positions: number[] = [];

  clauseWords.forEach((word, index) => {
    if (toConcept(word) !== actor) return;
    if (reportIndex >= 0 && index < reportIndex) return;
    let previous = index - 1;
    while (previous >= 0 && SUBJECT_MODIFIERS.has(clauseWords[previous])) previous -= 1;
    if (previous >= 0 && OBJECT_PREPOSITIONS.has(clauseWords[previous])) return;
    positions.push(index);
  });

  const reporter = reportIndex >= 0 ? clauseWords.slice(0, reportIndex).map(toConcept) : [];
  if (reporter.includes(actor)) {
    let reported = reportIndex + 1;
    if (clauseWords[reported] === 'that') reported += 1;
    if (SELF_REFERENCE_WORDS.has(clauseWords[reported])) positions.push(reported);
  }
  return positions.sort((a, b) => a - b);
}

// Evidence that the actor performs the action in this clause: the performer comes
// before the action. A limitation when negation lies between them.
function actionEvidenceInClause(clause: string, actor: string, action: string) {
  const clauseWords = words(clause);
  for (const performer of performerPositions(clauseWords, actor)) {
    const actionIndex = clauseWords.findIndex((word, index) => index > performer && toConcept(word) === action);
    if (actionIndex < 0) continue;
    const between = clauseWords.slice(performer + 1, actionIndex);
    return { limitation: between.some((word) => LIMITATION_WORDS.has(word)) };
  }
  return null;
}

// For each requested action, the first clause (taking passages in rank order) stating
// that the actor performs it or cannot perform it.
export function findRelationshipEvidence(actor: string, actions: string[], ranked: RankedEntry[]): ActionEvidence[] {
  const evidence: ActionEvidence[] = [];
  for (const action of actions) {
    search: for (const { entry } of ranked) {
      for (const clause of passageClauses(entry)) {
        const found = actionEvidenceInClause(clause, actor, action);
        if (found) {
          evidence.push({ action, entryId: entry.id, clause: clause.trim(), limitation: found.limitation });
          break search;
        }
      }
    }
  }
  return evidence;
}

// A passage complements the lead when it matches at least as many concepts and is
// genuinely about them: on its title/category, through the question's own phrase, or
// with a score equal to the lead's (the lead among equals is chosen by corpus order).
// Being about the question's actor ("Murdered Abroad and the FCDO" for a question about
// the charity) is not enough on its own.
function isComplementary(item: RankedEntry, lead: RankedEntry, actor: string | null) {
  const aboutTopic = item.topicMatches.some((concept) => concept !== actor);
  return (
    item.matchedConcepts.length >= lead.matchedConcepts.length &&
    (aboutTopic || item.phraseMatch || item.score >= lead.score)
  );
}

// Lead passage and all required relationship evidence, then passages covering topic
// concepts the selection lacks, then complementary passages. Returned in rank order.
export function selectEvidence(
  ranked: RankedEntry[],
  topicConcepts: string[],
  required: RankedEntry[] = [],
  actor: string | null = null
): RankedEntry[] {
  const [lead] = ranked;
  if (!lead) return [];
  const selected = new Set<RankedEntry>([lead, ...required]);
  const covers = (concept: string) => [...selected].some((item) => item.matchedConcepts.includes(concept));

  for (const concept of topicConcepts) {
    if (selected.size >= MAX_CONTEXT_ENTRIES || covers(concept)) continue;
    const coveringEntry = ranked.find((item) => !selected.has(item) && item.topicMatches.includes(concept));
    if (coveringEntry) selected.add(coveringEntry);
  }

  for (const item of ranked) {
    if (selected.size >= MAX_CONTEXT_ENTRIES) break;
    if (isComplementary(item, lead, actor)) selected.add(item);
  }

  return ranked.filter((item) => selected.has(item));
}

function result(
  queryConcepts: string[],
  fields: Partial<Pick<RetrievalResult, 'unsupportedConcepts' | 'uncoveredConcepts' | 'selected' | 'relationship'>>,
  fallbackReason: RetrievalFallbackReason | null
): RetrievalResult {
  const selected = fallbackReason ? [] : fields.selected ?? [];
  return {
    queryConcepts,
    unsupportedConcepts: fields.unsupportedConcepts ?? [],
    relationship: fields.relationship ?? null,
    uncoveredConcepts: fields.uncoveredConcepts ?? [],
    selected,
    matches: selected.map((item) => item.entry),
    fallbackUsed: fallbackReason !== null,
    fallbackReason,
  };
}

export function retrieve(message: string, entries: KnowledgeEntry[]): RetrievalResult {
  const queryConcepts = extractConcepts(message);

  if (queryConcepts.length === 0) {
    return result(queryConcepts, {}, 'no-topical-concepts');
  }
  if (hasUnresolvedReference(message, queryConcepts)) {
    return result(queryConcepts, {}, 'unresolved-reference');
  }

  const vocabulary = corpusVocabulary(entries);
  const unsupportedConcepts = queryConcepts.filter((concept) => !vocabulary.known.has(concept));
  if (unsupportedConcepts.length > 0) {
    return result(queryConcepts, { unsupportedConcepts }, 'unsupported-concept');
  }

  const ranked = rankEntries(queryConcepts, entries);

  let relationship: RelationshipEvidence | null = null;
  const actor = subjectActor(message);
  const actions = queryConcepts.filter((concept) => concept !== actor && ACTION_CONCEPTS.has(concept));
  if (actor && queryConcepts.includes(actor) && actions.length > 0) {
    relationship = { actor, actions, evidence: findRelationshipEvidence(actor, actions, ranked) };
    if (relationship.evidence.length < actions.length) {
      return result(queryConcepts, { relationship }, 'unsupported-relationship');
    }
  }

  const lead = ranked[0];
  if (lead.matchedConcepts.length < 2 && lead.topicMatches.length === 0) {
    return result(queryConcepts, { relationship }, 'weak-match');
  }

  const evidenceIds = new Set(relationship?.evidence.map((item) => item.entryId));
  const required = ranked.filter((item) => evidenceIds.has(item.entry.id));
  const topicConcepts = queryConcepts.filter((concept) => vocabulary.topics.has(concept));
  const selected = selectEvidence(ranked, topicConcepts, required, actor);
  const covered = new Set(selected.flatMap((item) => item.matchedConcepts));
  const uncoveredConcepts = queryConcepts.filter((concept) => !covered.has(concept));

  const topicsCovered = topicConcepts.every((concept) => covered.has(concept));
  const majorityCovered = queryConcepts.length - uncoveredConcepts.length >= requiredMatches(queryConcepts.length);
  if (!topicsCovered || !majorityCovered) {
    return result(queryConcepts, { relationship, uncoveredConcepts }, 'insufficient-coverage');
  }

  return result(queryConcepts, { relationship, selected, uncoveredConcepts }, null);
}
