// Crisis detection for incoming chat messages. Deterministic and deliberately
// conservative: explicit phrases in five categories. Generic words such as
// "emergency", "urgent" or "right now" are never enough on their own.
//
// Negation ("no emergency", "not in danger") is respected only for the danger and
// declared-emergency categories, and only within the same clause. Self-harm, overdose
// and weapon phrases trigger even when negated, because a false alarm is safer than a
// missed crisis there.
//
// The bare words "suicide" and "overdose" are ignored when their clause describes a
// cause of death ("the coroner ruled the death a suicide", "she died from an overdose"):
// this is a bereavement service, and families describe how someone died. Explicit
// current-crisis constructions ("I have taken an overdose", "thinking about suicide")
// are separate rules that the exception never applies to, so a reporting word in the
// same clause ("since the inquest ...") cannot hide them.

export type EmergencyCategory =
  | 'self-harm'
  | 'overdose'
  | 'weapon-or-attack'
  | 'immediate-danger'
  | 'declared-emergency';

type CrisisRule = {
  category: EmergencyCategory;
  patterns: RegExp[];
  respectsNegation: boolean;
  ignoresCauseOfDeath: boolean;
};

const PERSON = '(?:me|us|my (?:family|children|kids|child|wife|husband|partner|son|daughter|mum|dad|mother|father))';
const WEAPON = '(?:knife|gun|weapon|machete|blade|firearm|pistol|rifle)';

const CRISIS_RULES: CrisisRule[] = [
  {
    category: 'self-harm',
    respectsNegation: false,
    ignoresCauseOfDeath: true,
    patterns: [/\bsuicide\b/],
  },
  {
    category: 'self-harm',
    respectsNegation: false,
    ignoresCauseOfDeath: false,
    patterns: [
      /\bsuicidal\b/,
      /\b(?:think|thinking|thought|thoughts)\s+(?:about|of)\s+(?:committing\s+)?suicide\b/,
      /\b(?:considering|contemplating|planning|attempting|commit|committing)\s+suicide\b/,
      /\b(?:kill|killing|hurt|hurting|harm|harming|cut|cutting) myself\b/,
      /\bself[- ]?harm(?:ing|ed)?\b/,
      /\bend(?:ing)? (?:my (?:own )?life|it all)\b/,
      /\btake my (?:own )?life\b/,
      /\bwant(?:s|ed)? to die\b/,
      /\bwish i (?:was|were) dead\b/,
      /\bbetter off dead\b/,
      /\bdon'?t want to (?:live|be alive|be here|go on)\b/,
      /\bno (?:reason|point) (?:to|in) (?:live|living|going on)\b/,
    ],
  },
  {
    category: 'overdose',
    respectsNegation: false,
    ignoresCauseOfDeath: true,
    patterns: [/\boverdos(?:e|ed|ing)\b/],
  },
  {
    category: 'overdose',
    respectsNegation: false,
    ignoresCauseOfDeath: false,
    patterns: [
      /\b(?:have|has|'ve|'s)\s+(?:just\s+)?(?:taken|had|done)\s+(?:an\s+)?overdose\b/,
      /\b(?:i|we|he|she|they|you)\s+(?:just\s+)?overdosed\b/,
      /\b(?:take|taking)\s+(?:an\s+)?overdose\b/,
      /\b(?:going to|gonna|about to|planning to|thinking about|thinking of)\s+(?:take\s+an\s+)?overdos(?:e|ing)\b/,
      /\b(?:taken|took|swallowed|had)\b.{0,20}\b(?:too many|a lot of|all (?:of )?(?:my|the)|loads of|a whole|an entire)\b.{0,20}\b(?:pills|tablets|medication|medicine|paracetamol|painkillers)\b/,
      /\bpoisoned (?:myself|me)\b/,
      /\b(?:drank|drunk|swallowed) (?:bleach|poison)\b/,
    ],
  },
  {
    category: 'weapon-or-attack',
    respectsNegation: false,
    ignoresCauseOfDeath: false,
    patterns: [
      // Present tense only: "was killed with a knife" describes the murder, not a threat.
      new RegExp(`\\b(?:has|have|holding|carrying|waving|pointing|brandishing)\\s+(?:got\\s+)?(?:a|an)\\s+${WEAPON}\\b`),
      new RegExp(`\\b(?:is|are|'s|'re)\\s+(?:\\w+\\s+){0,3}with\\s+(?:a|an)\\s+${WEAPON}\\b`),
      new RegExp(`\\b(?:attacking|threatening|hurting|chasing|stalking|following) ${PERSON}\\b`),
      new RegExp(`\\b(?:going to|gonna|will|trying to) (?:kill|hurt|attack|stab|shoot) ${PERSON}\\b`),
      new RegExp(`\\bthreatened to (?:kill|hurt|attack) ${PERSON}\\b`),
      /\bbeing (?:attacked|threatened|followed|chased)\b/,
      /\b(?:attack|violence|assault) (?:is )?happening\b/,
    ],
  },
  {
    category: 'immediate-danger',
    respectsNegation: true,
    ignoresCauseOfDeath: false,
    patterns: [
      /\b(?:immediate|imminent|urgent|serious|grave) danger\b/,
      /\bdanger now\b/,
      /\bin danger\b/,
      /\b(?:unsafe|not safe) (?:right )?now\b/,
      /\b(?:i'm|i am|we're|we are) (?:not safe|unsafe)\b/,
    ],
  },
  {
    category: 'declared-emergency',
    respectsNegation: true,
    ignoresCauseOfDeath: false,
    patterns: [
      /\b(?:this|it) is an emergency\b/,
      /\b(?:this|it)'s an emergency\b/,
      /\bmedical emergency\b/,
      /\bcall (?:an )?ambulance\b/,
    ],
  },
];

// A clause ends at punctuation, a new line (normalised to a full stop) or a joining
// word, so "I am not alone and I am in danger" has two clauses.
const CLAUSE_BOUNDARY = /[.,;:!?]|\b(?:and|but|however|yet|then)\b/g;

// Negation within a short distance before a danger or emergency phrase, in the same
// clause, cancels it: "there is no immediate danger", "I'm not in danger".
const NEGATION = /\b(?:no|not|never|isn't|aren't|wasn't|nothing|nobody)\b/;
const NEGATION_DISTANCE = 30;

// Words that make a clause a description of how someone died.
const CAUSE_OF_DEATH = /\b(?:died|dies|death|dead|ruled|verdict|coroner|inquest|post-mortem|autopsy|reports?|reported|mentions?|mentioned|records?|recorded|cause)\b/;

function normalise(message: string) {
  return message
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s*\n\s*/g, '. ')
    .replace(/\s+/g, ' ');
}

// The clause containing text[start, end), and the part of it before start.
function clauseAround(text: string, start: number, end: number) {
  let clauseStart = 0;
  let clauseEnd = text.length;
  for (const boundary of text.matchAll(CLAUSE_BOUNDARY)) {
    const boundaryEnd = boundary.index + boundary[0].length;
    if (boundaryEnd <= start) clauseStart = boundaryEnd;
    else if (boundary.index >= end) {
      clauseEnd = boundary.index;
      break;
    }
  }
  return { before: text.slice(clauseStart, start), clause: text.slice(clauseStart, clauseEnd) };
}

function isNegated(text: string, start: number, end: number) {
  return NEGATION.test(clauseAround(text, start, end).before.slice(-NEGATION_DISTANCE));
}

function describesCauseOfDeath(text: string, start: number, end: number) {
  return CAUSE_OF_DEATH.test(clauseAround(text, start, end).clause);
}

// The first crisis category the message falls into, or null.
export function detectEmergency(message: string): EmergencyCategory | null {
  const text = normalise(message);
  for (const rule of CRISIS_RULES) {
    for (const pattern of rule.patterns) {
      const matcher = new RegExp(pattern.source, 'g');
      for (const match of text.matchAll(matcher)) {
        const end = match.index + match[0].length;
        if (rule.respectsNegation && isNegated(text, match.index, end)) continue;
        if (rule.ignoresCauseOfDeath && describesCauseOfDeath(text, match.index, end)) continue;
        return rule.category;
      }
    }
  }
  return null;
}

export function isEmergencyMessage(message: string): boolean {
  return detectEmergency(message) !== null;
}
