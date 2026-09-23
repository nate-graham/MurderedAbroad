// Fixed (non-generated) responses: the emergency response and the no-match fallback.
import type { ChatSource, ChatSuccessResponse } from '@/lib/chat-types';
import { getContactMethod, signposting } from '@/lib/signposting';

const charityEmail = getContactMethod(signposting.primaryContact, 'email');
const charityPhone = getContactMethod(signposting.primaryContact, 'phone');

export const charityContactSource: ChatSource = {
  title: 'How to contact Murdered Abroad Charity',
  sourceName: 'Murdered Abroad Charity',
  sourceUrl: getContactMethod(signposting.primaryContact, 'url'),
  category: 'charity_contact',
};

const fallbackAnswer = `I could not find a clear answer in the approved source material.\n\nThe safest next step is to contact Murdered Abroad Charity directly: ${charityEmail} or helpline ${charityPhone}.\n\nYou can also contact the nearest British Embassy, High Commission or Consulate, or local police/authorities in the country involved. If there is immediate danger, contact emergency services immediately.`;

const emergencyAnswer = `If there is immediate danger, contact emergency services immediately.\n\n1. Contact local emergency services now.\n2. Contact local police or authorities in the country involved.\n3. Once the immediate danger is being handled, contact Murdered Abroad Charity at ${charityEmail} or helpline ${charityPhone}, or contact the nearest British Embassy, High Commission or Consulate for support routes.\n\nIf you are unsure who to contact, contact emergency services first if anyone is at immediate risk.`;

export function fallbackResponse(): ChatSuccessResponse {
  return {
    answer: fallbackAnswer,
    sources: [charityContactSource],
    fallbackUsed: true,
  };
}

export function emergencyResponse(): ChatSuccessResponse {
  return {
    answer: emergencyAnswer,
    sources: [charityContactSource],
    fallbackUsed: true,
  };
}
