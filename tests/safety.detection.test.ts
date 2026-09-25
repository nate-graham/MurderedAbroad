// Crisis detection and emergency-response semantics (Phase 3A). Written before the
// safety detector was replaced; they describe the required behaviour.
import assert from 'node:assert/strict';
import { promises as fsPromises } from 'node:fs';
import { beforeEach, describe, test } from 'node:test';
import { isEmergencyMessage } from '@/lib/safety';
import { askChat, EMERGENCY_PREFIX, FALLBACK_PREFIX, mockOpenAI } from './helpers/chat-route';

const EMERGENCIES = [
  // Previously missed crises
  'I have taken an overdose',
  'He is outside with a knife',
  'I want to die',
  'I feel suicidal',
  // Direct danger and attack
  "I'm in immediate danger",
  'Someone is attacking me',
  'He has a knife and is threatening me',
  // Overdose and self-harm
  "I've taken too many tablets",
  'I want to kill myself',
  "I don't want to live anymore",
  'I have been self-harming',
  // Emergency language with context
  'This is an emergency, please help',
];

const NON_EMERGENCIES = [
  // Previously false positives
  'I need help right now with funeral paperwork',
  'There is no emergency; how do I contact the embassy?',
  'No emergency, I just need advice about repatriation.',
  // Ordinary urgency, negated danger and past events
  'The police said there is no immediate danger',
  'This is urgent paperwork',
  'I need help right now with repatriation',
  'Is there an emergency contact number?',
  'The murder happened years ago',
  'I am worried about the investigation',
  "I'm not in danger, I just need to know about the coroner",
  'My son was killed with a knife in Spain. What should I do first?',
  'The attacker had a gun.',
  'Who can help with repatriation?',
];

describe('crisis detection', () => {
  for (const message of EMERGENCIES) {
    test(`emergency: "${message}"`, () => assert.equal(isEmergencyMessage(message), true));
  }

  for (const message of NON_EMERGENCIES) {
    test(`not an emergency: "${message}"`, () => assert.equal(isEmergencyMessage(message), false));
  }

  test('a crisis later in a longer message is still detected', () => {
    assert.equal(isEmergencyMessage("I can't cope with the court case, I want to kill myself"), true);
  });

  test('curly apostrophes and capitals do not hide a crisis', () => {
    assert.equal(isEmergencyMessage('I DON’T WANT TO LIVE ANYMORE'), true);
  });
});

describe('emergency response', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_MODEL;
  });

  test('is not labelled as a retrieval fallback and never reads the knowledge base or calls OpenAI', async (t) => {
    const readFile = t.mock.method(fsPromises, 'readFile', async () => {
      throw new Error('knowledge base must not be read');
    });
    const calls = mockOpenAI(t);

    for (const message of ['I have taken an overdose', 'He is outside with a knife', 'I feel suicidal']) {
      const { status, json } = await askChat(message);
      assert.equal(status, 200, message);
      assert.ok(json.answer.startsWith(EMERGENCY_PREFIX), message);
      assert.equal(json.fallbackUsed, false, message);
    }
    assert.equal(readFile.mock.callCount(), 0);
    assert.equal(calls.length, 0);
  });

  test('former false positives take the normal retrieval path instead of the emergency response', async (t) => {
    const calls = mockOpenAI(t);
    for (const message of [
      'I need help right now with funeral paperwork',
      'There is no emergency; how do I contact the embassy?',
      'No emergency, I just need advice about repatriation.',
    ]) {
      const { json } = await askChat(message);
      assert.ok(!json.answer.startsWith(EMERGENCY_PREFIX), message);
      // Retrieval (unchanged in Phase 3A) does not recognise "emergency", "right now" or
      // "paperwork", so these receive the fixed retrieval fallback.
      assert.ok(json.answer.startsWith(FALLBACK_PREFIX), message);
      assert.equal(json.fallbackUsed, true, message);
    }
    assert.equal(calls.length, 0);
  });
});

describe('crisis phrases need their full wording', () => {
  test('"at the end my son..." is not "end my life"', () => {
    assert.equal(isEmergencyMessage('At the end my son was repatriated.'), false);
  });

  test('"end it all" and "ending my own life" are detected', () => {
    assert.equal(isEmergencyMessage('I just want to end it all'), true);
    assert.equal(isEmergencyMessage('I am thinking about ending my own life'), true);
  });
});

// Phase 3A correction: negation must not cross a clause boundary (punctuation, a
// conjunction or a new line), and cause-of-death descriptions are not crises.
describe('negation stays within its clause', () => {
  for (const message of [
    'I am not alone and I am in danger.',
    'I am not alone but I am in danger',
    'I am not alone\nI am in danger',
    'I am not scared, however I am in danger now',
    'There is no emergency paperwork issue, but someone is outside with a knife.',
    'I am not in danger, but he is outside with a knife.',
  ]) {
    test(`emergency: ${JSON.stringify(message)}`, () => assert.equal(isEmergencyMessage(message), true));
  }

  for (const message of ['There is no emergency', 'I am not in danger', 'The police said there is no immediate danger']) {
    test(`not an emergency: ${JSON.stringify(message)}`, () => assert.equal(isEmergencyMessage(message), false));
  }
});

describe('cause-of-death descriptions are not crises', () => {
  for (const message of [
    'The victim died by suicide.',
    'The coroner ruled the death a suicide.',
    'The report mentions an overdose.',
    'She died from an overdose.',
    'The inquest recorded an overdose as the cause of death.',
  ]) {
    test(`not an emergency: "${message}"`, () => assert.equal(isEmergencyMessage(message), false));
  }

  for (const message of [
    'I feel suicidal.',
    'I want to die.',
    'I want to kill myself.',
    'I have taken an overdose.',
    "I've taken too many tablets.",
    "I'm not suicidal.",
    "I'm not going to kill myself.",
    'I have not taken an overdose.',
    'He has taken an overdose.',
    'I am thinking about suicide.',
    'suicide',
  ]) {
    test(`still an emergency: "${message}"`, () => assert.equal(isEmergencyMessage(message), true));
  }

  test('cause-of-death words do not cancel personal crisis phrases in the same clause', () => {
    for (const message of [
      'Since the inquest I want to kill myself',
      "Reading the coroner's report I feel suicidal",
      "After the verdict I've taken too many tablets",
    ]) {
      assert.equal(isEmergencyMessage(message), true, message);
    }
  });

  test('a cause-of-death description does not hide a separate present crisis', () => {
    assert.equal(isEmergencyMessage('The coroner ruled the death a suicide, but I want to kill myself.'), true);
    assert.equal(isEmergencyMessage('The report mentions an overdose and I have taken an overdose too.'), true);
  });
});

describe('route: clause and cause-of-death corrections', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_MODEL;
  });

  test('a later crisis after a negated clause gets the emergency response without retrieval or OpenAI', async (t) => {
    const readFile = t.mock.method(fsPromises, 'readFile', async () => {
      throw new Error('knowledge base must not be read');
    });
    const calls = mockOpenAI(t);
    for (const message of ['I am not alone and I am in danger.', 'I am not in danger, but he is outside with a knife.']) {
      const { json } = await askChat(message);
      assert.ok(json.answer.startsWith(EMERGENCY_PREFIX), message);
      assert.equal(json.fallbackUsed, false, message);
    }
    assert.equal(readFile.mock.callCount(), 0);
    assert.equal(calls.length, 0);
  });

  test('a cause-of-death description is not answered with the emergency response', async (t) => {
    mockOpenAI(t);
    for (const message of ['The coroner ruled the death a suicide.', 'She died from an overdose.']) {
      const { json } = await askChat(message);
      assert.ok(!json.answer.startsWith(EMERGENCY_PREFIX), message);
    }
  });
});

// Phase 3A correction: explicit current-crisis constructions take precedence over the
// cause-of-death exception, even when a reporting word shares their clause.
describe('explicit current crises are not hidden by cause-of-death words', () => {
  const CURRENT_CRISES_WITH_REPORTING_WORDS = [
    'Since the inquest I have taken an overdose.',
    'Since the inquest I am thinking about suicide.',
    'I have taken an overdose after reading the report.',
  ];

  for (const message of CURRENT_CRISES_WITH_REPORTING_WORDS) {
    test(`emergency: "${message}"`, () => assert.equal(isEmergencyMessage(message), true));
  }

  for (const message of [
    'After the verdict he has just taken an overdose.',
    'Since the coroner called, I overdosed.',
    'Since the inquest I overdosed.',
    'I am going to take an overdose because of the report.',
    'Since the inquest I have been considering suicide.',
    'After the coroner ruled, I want to commit suicide.',
  ]) {
    test(`emergency: "${message}"`, () => assert.equal(isEmergencyMessage(message), true));
  }

  for (const message of [
    'The victim died by suicide.',
    'The coroner ruled the death a suicide.',
    'The report mentions an overdose.',
    'She died from an overdose.',
    'The inquest recorded an overdose as the cause of death.',
    'The report says he committed suicide.',
  ]) {
    test(`not an emergency: "${message}"`, () => assert.equal(isEmergencyMessage(message), false));
  }

  test('route: the emergency response without knowledge base, retrieval or OpenAI', async (t) => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_MODEL;
    const readFile = t.mock.method(fsPromises, 'readFile', async () => {
      throw new Error('knowledge base must not be read');
    });
    const calls = mockOpenAI(t);

    for (const message of CURRENT_CRISES_WITH_REPORTING_WORDS) {
      const { status, json } = await askChat(message);
      assert.equal(status, 200, message);
      assert.ok(json.answer.startsWith(EMERGENCY_PREFIX), message);
      assert.equal(json.fallbackUsed, false, message);
    }
    assert.equal(readFile.mock.callCount(), 0);
    assert.equal(calls.length, 0);
  });
});
