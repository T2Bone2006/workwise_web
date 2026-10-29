import { describe, expect, it } from 'vitest';
import { isRemainingVisit, noticePlan } from '@/lib/rounds/remaining-plan';

const house = {
  customerId: '33333333-3333-3333-3333-333333333333',
  address: '12 Elm Road',
  postcode: 'SW1A 1AA',
};

describe('isRemainingVisit', () => {
  it('keeps the day plan leftovers and drops settled visits', () => {
    expect(isRemainingVisit('assigned')).toBe(true);
    expect(isRemainingVisit('in_progress')).toBe(true);
    expect(isRemainingVisit('completed')).toBe(false);
    expect(isRemainingVisit('cancelled')).toBe(false);
    expect(isRemainingVisit('declined')).toBe(false);
    expect(isRemainingVisit('incomplete')).toBe(false);
  });
});

describe('noticePlan', () => {
  it('sends one message per house, and an invoice on its own when the message is off', () => {
    const plan = noticePlan([
      { jobId: 'a', ...house, sendMessage: true, sendInvoice: false },
      { jobId: 'b', ...house, sendMessage: false, sendInvoice: true },
      {
        jobId: 'c',
        customerId: '44444444-4444-4444-4444-444444444444',
        address: '4 Mill Lane',
        postcode: 'E1 1AA',
        sendMessage: false,
        sendInvoice: true,
      },
      {
        jobId: 'd',
        customerId: '55555555-5555-5555-5555-555555555555',
        address: '9 Oak Street',
        postcode: 'N1 9GU',
        sendMessage: false,
        sendInvoice: false,
      },
    ]);

    expect(plan.messages).toEqual([
      { jobId: 'a', customerId: house.customerId, sendInvoice: true },
    ]);
    expect(plan.invoiceOnly).toEqual([
      { customerId: '44444444-4444-4444-4444-444444444444', jobIds: ['c'] },
    ]);
  });
});
