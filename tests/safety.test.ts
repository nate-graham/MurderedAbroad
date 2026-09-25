// Direct unit tests for lib/safety.ts. Phase 3A replaced the single keyword regex with
// explicit crisis categories; tests/safety.detection.test.ts holds the realistic probes.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { detectEmergency, isEmergencyMessage } from '@/lib/safety';

describe('isEmergencyMessage', () => {
  // Crisis phrases carried over from the original detector.
  for (const phrase of [
    'immediate danger',
    'danger now',
    'urgent danger',
    'suicide',
    'self-harm',
    'self harm',
    'selfharm',
    'kill myself',
    'end my life',
    'being attacked',
    'attack happening',
    'violence happening',
    'unsafe now',
  ]) {
    test(`detects "${phrase}"`, () => {
      assert.equal(isEmergencyMessage(`I think ${phrase} here`), true);
    });
  }

  // Generic words that the original detector treated as crises on their own.
  for (const phrase of ['emergency', 'threat', 'threatened', 'right now', 'urgent']) {
    test(`"${phrase}" alone is not enough`, () => {
      assert.equal(isEmergencyMessage(`I think ${phrase} here`), false);
    });
  }

  test('is case-insensitive', () => {
    assert.equal(isEmergencyMessage('I AM IN IMMEDIATE DANGER'), true);
  });

  test('requires word boundaries', () => {
    assert.equal(isEmergencyMessage('overdosed'), true);
    assert.equal(isEmergencyMessage('endanger nothing'), false);
  });

  test('returns the same result on repeated calls', () => {
    assert.equal(isEmergencyMessage('I want to die'), true);
    assert.equal(isEmergencyMessage('I want to die'), true);
  });

  test('does not flag an ordinary question', () => {
    assert.equal(isEmergencyMessage('Who can help with repatriation?'), false);
  });

  test('detects "suicidal"', () => {
    assert.equal(isEmergencyMessage('I feel suicidal'), true);
  });

  test('respects negation of danger and emergency language', () => {
    assert.equal(isEmergencyMessage('There is no emergency'), false);
    assert.equal(isEmergencyMessage('It is not an emergency'), false);
    assert.equal(isEmergencyMessage("We're not in danger"), false);
  });

  test('a negation in an earlier clause does not cancel a later crisis', () => {
    assert.equal(isEmergencyMessage("It's not the court case, I am in danger now"), true);
  });

  test('does not let negation cancel self-harm, overdose or weapon phrases', () => {
    assert.equal(isEmergencyMessage("I'm not going to kill myself"), true);
    assert.equal(isEmergencyMessage("I didn't mean to overdose"), true);
  });
});

describe('detectEmergency', () => {
  test('names the crisis category', () => {
    assert.equal(detectEmergency('I feel suicidal'), 'self-harm');
    assert.equal(detectEmergency("I've taken too many tablets"), 'overdose');
    assert.equal(detectEmergency('He has a knife'), 'weapon-or-attack');
    assert.equal(detectEmergency("I'm in immediate danger"), 'immediate-danger');
    assert.equal(detectEmergency('This is an emergency'), 'declared-emergency');
    assert.equal(detectEmergency('Who can help with repatriation?'), null);
  });
});
