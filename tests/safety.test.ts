// Direct unit tests for lib/safety.ts. These pin the current regex behaviour;
// KNOWN WEAKNESS cases are expected to change in a later phase.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isEmergencyMessage } from '@/lib/safety';

describe('isEmergencyMessage', () => {
  for (const phrase of [
    'immediate danger',
    'danger now',
    'urgent danger',
    'emergency',
    'suicide',
    'self-harm',
    'self harm',
    'selfharm',
    'kill myself',
    'end my life',
    'threat',
    'threatened',
    'violence happening',
    'being attacked',
    'attack happening',
    'unsafe now',
    'right now',
  ]) {
    test(`detects "${phrase}"`, () => {
      assert.equal(isEmergencyMessage(`I think ${phrase} here`), true);
    });
  }

  test('is case-insensitive', () => {
    assert.equal(isEmergencyMessage('EMERGENCY'), true);
  });

  test('requires word boundaries', () => {
    assert.equal(isEmergencyMessage('emergencyservices'), false);
    assert.equal(isEmergencyMessage('threats'), false);
  });

  test('returns the same result on repeated calls', () => {
    assert.equal(isEmergencyMessage('emergency'), true);
    assert.equal(isEmergencyMessage('emergency'), true);
  });

  test('does not flag an ordinary question', () => {
    assert.equal(isEmergencyMessage('Who can help with repatriation?'), false);
  });

  test('KNOWN WEAKNESS: "suicidal" is not detected', () => {
    assert.equal(isEmergencyMessage('I feel suicidal'), false);
  });

  test('KNOWN WEAKNESS: negated "no emergency" is detected', () => {
    assert.equal(isEmergencyMessage('There is no emergency'), true);
  });
});
