// Curated retrieval vocabulary. These lists shape how questions and knowledge
// entries are turned into topical concepts. They are retrieval metadata only: they
// add no factual content, and the raw question is always passed on unchanged.

// Grammatical words. Removed from questions and knowledge entries.
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'after', 'also', 'an', 'and', 'another', 'are', 'been', 'being', 'can', 'did', 'do', 'does',
  'done', 'for', 'from', 'get', 'going', 'got', 'happen', 'happened', 'happens', 'has', 'have',
  'help', 'how', 'i', 'if', 'in', 'is', 'it', 'just', 'like', 'many', 'me', 'much', 'my', 'of',
  'or', 'our', 'should', 'some', 'that', 'the', 'their', 'them', 'there', 'these', 'they',
  'this', 'those', 'to', 'was', 'were', 'what', 'when', 'where', 'who', 'with', 'you', 'your',
]);

// Modal and scope words (obligation, possibility, choice, capability). They are
// ignored when finding topics and are never counted as evidence that a question is
// covered. The model still receives them in the raw question.
export const MODAL_AND_SCOPE_WORDS: ReadonlySet<string> = new Set([
  'able', 'allowed', 'any', 'anyone', 'anything', 'available', 'could', 'may', 'might', 'must', 'need',
  'permitted', 'still', 'want', 'which', 'why', 'will', 'would',
]);

// How people frame a question rather than what it is about: politeness, emotional
// state, requests for explanation, coping verbs ("how do I deal with X" asks about X),
// and who the bereaved person is.
export const FRAMING_WORDS: ReadonlySet<string> = new Set([
  // Politeness and requests
  'appreciate', 'explain', 'find', 'grateful', 'guidance', 'kindly', 'know', 'please', 'really',
  'someone', 'something', 'sorry', 'tell', 'thank', 'thanks', 'understand',
  // Coping verbs
  'cope', 'deal', 'handle',
  // Emotional state
  'confused', 'overwhelmed', 'scared', 'struggling', 'upset', 'worried',
  // Relationship to the person who died
  'aunt', 'brother', 'child', 'children', 'cousin', 'dad', 'daughter', 'father', 'friend',
  'grandfather', 'grandmother', 'husband', 'loved', 'mother', 'mum', 'one', 'parent', 'parents',
  'partner', 'relative', 'sister', 'son', 'uncle', 'wife',
]);

// Words describing the bereavement itself, which every approved passage presupposes.
export const SITUATION_WORDS: ReadonlySet<string> = new Set(['killed', 'manslaughter', 'murder', 'murdered']);

// Negation does not identify a topic and would otherwise match almost any passage.
// Includes the fragments left when an apostrophe splits a contraction ("don't" -> "don").
export const NEGATION_TOKENS: ReadonlySet<string> = new Set([
  'not', 'never', 'cannot',
  'aren', 'couldn', 'didn', 'doesn', 'don', 'hadn', 'hasn', 'haven', 'isn', 'shouldn', 'wasn',
  'weren', 'won', 'wouldn',
]);

// Concepts that appear in almost every approved entry (tested) and so cannot
// distinguish one passage from another.
export const CORPUS_WIDE_CONCEPTS: ReadonlySet<string> = new Set(['abroad']);

// Pronouns that stand for an actor or object named in an earlier message. A question
// containing one cannot be resolved without conversation context.
export const ACTOR_REFERENCE_WORDS: ReadonlySet<string> = new Set(['they', 'them', 'those', 'these']);

// Demonstratives that may point back to an earlier message ("How much will this cost?")
// or may simply refer to the user's situation ("if this happened abroad").
export const DEMONSTRATIVE_REFERENCE_WORDS: ReadonlySet<string> = new Set(['it', 'this', 'that']);

// "this happened", "it has happened", "that occurred": the demonstrative refers to
// the user's own situation, not to an earlier message.
export const SITUATION_REFERENCE_PATTERN = /\b(?:it|this|that)\s+(?:has\s+)?(?:happened|happens|occurred)\b/i;

// Multi-word expressions rewritten to one token before tokenising, in questions and
// knowledge entries alike. Applied in order.
export const PHRASE_ALIASES: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // "press charges" is about prosecution, which the approved sources do not cover;
  // it must not reach the "press" -> media alias below.
  { pattern: /\bpress(?:es|ed|ing)?\s+charges?\b/gi, replacement: ' press-charges ' },
  // What happens after repatriation (coroner, post-mortem) is a distinct topic from
  // repatriation itself; it must not claim generic repatriation questions.
  { pattern: /\bafter\s+repatriation\b/gi, replacement: ' after-repatriation ' },
  // "bring my brother home", "bringing a body home"
  { pattern: /\bbring(?:s|ing)?\s+(?:[a-z'’]+\s+){0,3}home\b/gi, replacement: ' repatriation ' },
  // "police force" is the police, not a request to force something.
  { pattern: /\bpolice\s+force\b/gi, replacement: ' police ' },
  // The charity by name. Case-sensitive: "my father was murdered abroad" describes the
  // situation, not the charity.
  { pattern: /\bMurdered Abroad\b/g, replacement: ' charity ' },
];

// In passage titles, "... from Murdered Abroad" credits the publisher; it does not
// make the charity the topic of the passage. Applied to titles only, before the
// phrase aliases.
export const TITLE_ATTRIBUTION_PATTERN = /\bfrom Murdered Abroad\b/g;

// Who a question can ask about as the one doing something. Detected as the grammatical
// subject ("Can the police ...", "Does Murdered Abroad ...").
export const ACTOR_CONCEPTS: ReadonlySet<string> = new Set([
  'charity', 'coroner', 'court', 'embassy', 'fcdo', 'government', 'homicide', 'lawyer', 'media', 'police',
]);

// What a question can ask an actor to do. When a question asks whether an actor does
// one of these, an approved clause must state that the actor does (or cannot do) it.
export const ACTION_CONCEPTS: ReadonlySet<string> = new Set([
  'conduct', 'cost', 'force', 'investigation', 'post-mortem', 'provide', 'share', 'speed',
]);

// Auxiliary and modal verbs that introduce the subject of a yes/no or wh- question.
export const SUBJECT_AUXILIARIES: ReadonlySet<string> = new Set([
  'are', 'can', 'could', 'did', 'do', 'does', 'has', 'have', 'is', 'may', 'might', 'must', 'should', 'was',
  'were', 'will', 'would',
]);

// Words allowed between the auxiliary and the subject ("Can the local police ...").
export const SUBJECT_MODIFIERS: ReadonlySet<string> = new Set([
  'a', 'an', 'british', 'foreign', 'local', 'my', 'our', 'the', 'uk', 'your',
]);

// Words that introduce another actor asked or expected to act, in the pattern
// "<introducer> [the] <actor> to <action>": "Can I get the police to pay ...", "How do
// I ask the embassy to ...", "I want the police to pay ...", "Is it possible for the
// police to pay ...".
export const REQUEST_VERBS: ReadonlySet<string> = new Set([
  'ask', 'asking', 'expect', 'for', 'get', 'getting', 'need', 'needs', 'want', 'wants',
]);

// Verbs that introduce a report. In "Murdered Abroad says the death should be
// investigated by the authorities", the charity reports; it does not investigate.
export const REPORTING_VERBS: ReadonlySet<string> = new Set([
  'advises', 'describes', 'explains', 'notes', 'recommends', 'reports', 'said', 'says', 'states',
]);

// Words by which a reporter refers to itself ("Murdered Abroad says it provides ...").
export const SELF_REFERENCE_WORDS: ReadonlySet<string> = new Set(['it']);

// A noun after one of these is an object, not the performer ("a meeting with local police").
export const OBJECT_PREPOSITIONS: ReadonlySet<string> = new Set(['by', 'for', 'from', 'of', 'on', 'to', 'with']);

// Negation that, placed between the performer and the action, states a limitation
// ("it cannot provide", "has no power to speed up").
export const LIMITATION_WORDS: ReadonlySet<string> = new Set(['cannot', 'never', 'no', 'not', 'unable']);

// Canonical concept -> word forms that mean the same thing for retrieval.
// Every canonical concept occurs in the approved corpus (tested). Groups either join
// inflections the corpus itself uses, or map a common word onto a corpus concept.
// Institution names are grouped, but a service offered by an institution must still
// be matched on its own.
export const CONCEPT_ALIAS_GROUPS: Readonly<Record<string, readonly string[]>> = {
  abroad: ['overseas'],
  appoint: ['appointed', 'appointing', 'appoints'],
  attend: ['attendance', 'attended', 'attending'],
  case: ['cases'],
  contact: ['contacts'],
  coroner: ['coroners', 'inquest', 'inquests'],
  cost: [
    'afford', 'costly', 'costs', 'fee', 'fees', 'financial', 'fund', 'funded', 'funding', 'funds', 'money', 'paid',
    'pay', 'paying', 'pays',
  ],
  embassy: ['consular', 'consulate', 'consulates', 'embassies'],
  interpreter: ['interpreters'],
  investigation: ['investigate', 'investigated', 'investigates', 'investigating', 'investigations', 'investigative'],
  lawyer: ['lawyers', 'solicitor', 'solicitors'],
  media: ['journalist', 'journalists', 'press', 'reporters'],
  'post-mortem': ['autopsies', 'autopsy', 'postmortem'],
  provide: ['give', 'gives', 'giving', 'offer', 'offered', 'offering', 'offers', 'provided', 'provides', 'providing'],
  repatriation: ['repatriate', 'repatriated', 'repatriating'],
  translation: ['translated'],
  translator: ['translators'],
  trial: ['trials'],
};
