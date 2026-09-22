// Central contact and signposting configuration.
//
// Values below mirror what the app currently hardcodes in app/api/chat/route.ts
// and the chat component. None are client-approved yet, and this module is not
// yet used by the app. The helpline number in particular could not be found on
// murdered-abroad.org.uk and must be confirmed by the client before launch.

export type ApprovalStatus = 'pending-client-approval' | 'approved';

export type ContactMethod =
  | { kind: 'phone'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'url'; value: string };

export type SignpostingContact = {
  id: string;
  name: string;
  description?: string;
  methods: ContactMethod[];
  approvalStatus: ApprovalStatus;
};

export type SignpostingConfig = {
  primaryContact: SignpostingContact;
  // Ordered list shown to users who are unsure who to contact.
  contacts: SignpostingContact[];
  // Shown when there may be immediate danger.
  emergencyContact: SignpostingContact;
};

const murderedAbroadCharity: SignpostingContact = {
  id: 'murdered-abroad-charity',
  name: 'Murdered Abroad Charity',
  methods: [
    { kind: 'email', value: 'support@murdered-abroad.org.uk' },
    { kind: 'phone', value: '0845 123 2384' },
    { kind: 'url', value: 'https://www.murdered-abroad.org.uk/contact' },
  ],
  approvalStatus: 'pending-client-approval',
};

const emergencyServices: SignpostingContact = {
  id: 'emergency-services',
  name: 'Emergency services',
  description: 'If there is immediate danger',
  methods: [],
  approvalStatus: 'pending-client-approval',
};

export const signposting: SignpostingConfig = {
  primaryContact: murderedAbroadCharity,
  contacts: [
    murderedAbroadCharity,
    {
      id: 'british-embassy',
      name: 'British Embassy, High Commission or Consulate',
      methods: [],
      approvalStatus: 'pending-client-approval',
    },
    {
      id: 'local-police',
      name: 'Local police or authorities',
      description: 'In the country involved',
      methods: [],
      approvalStatus: 'pending-client-approval',
    },
    emergencyServices,
  ],
  emergencyContact: emergencyServices,
};
