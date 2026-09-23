import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getContactMethod, signposting } from '@/lib/signposting';

describe('getContactMethod', () => {
  test('returns the primary contact methods', () => {
    assert.equal(getContactMethod(signposting.primaryContact, 'email'), 'support@murdered-abroad.org.uk');
    assert.equal(getContactMethod(signposting.primaryContact, 'phone'), '0845 123 2384');
    assert.equal(getContactMethod(signposting.primaryContact, 'url'), 'https://www.murdered-abroad.org.uk/contact');
  });

  test('throws when the contact has no method of that kind', () => {
    assert.throws(() => getContactMethod(signposting.emergencyContact, 'phone'), /has no phone contact method/);
  });

  test('every contact is still pending client approval', () => {
    for (const contact of signposting.contacts) {
      assert.equal(contact.approvalStatus, 'pending-client-approval', contact.id);
    }
  });
});
