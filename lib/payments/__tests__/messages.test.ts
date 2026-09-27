import { describe, expect, it } from 'vitest';
import {
  composePaymentReceivedMessage,
  composeShareMessage,
  composeVisitDoneMessage,
  type VisitDoneMessageInput,
} from '@/lib/payments/messages';

const base: VisitDoneMessageInput = {
  businessName: "Dave's Window Cleaning",
  customerName: 'Sarah Smith',
  visitDate: '2026-09-24',
  serviceTitle: 'Window clean (front & back)',
  address: '12 Elm Road, SW1A 1AA',
  visitDue: 18,
  paidNow: null,
  visitStatus: 'unpaid',
  visitOutstanding: 18,
  customerOwedTotal: 18,
  customerCredit: 0,
  payUrl: 'https://app.joinworkwise.com/pay/tok',
  bank: {
    accountName: "Dave's Window Cleaning",
    sortCode: '123456',
    accountNumber: '12345678',
  },
  reference: 'SMITH12',
  invoiceNumber: null,
};

describe('composeVisitDoneMessage', () => {
  it('returns null when waived', () => {
    expect(
      composeVisitDoneMessage({ ...base, visitStatus: 'waived' }),
    ).toBeNull();
  });

  it('uses Hi {first} greeting and Hello fallback for titles', () => {
    const hi = composeVisitDoneMessage(base)!;
    expect(hi.greeting).toBe('Hi Sarah,');
    const hello = composeVisitDoneMessage({
      ...base,
      customerName: 'Mr Smith',
    })!;
    expect(hello.greeting).toBe('Hello,');
  });

  it('subject is visit day when no invoice', () => {
    const msg = composeVisitDoneMessage(base)!;
    expect(msg.subject).toBe(
      "Dave's Window Cleaning: your visit on Thu 24 Sep",
    );
  });

  it('subject uses invoice number when set', () => {
    const msg = composeVisitDoneMessage({
      ...base,
      invoiceNumber: 'INV-0001',
    })!;
    expect(msg.subject).toBe(
      "Invoice INV-0001 from Dave's Window Cleaning",
    );
    expect(msg.paragraphs).toContain('Invoice INV-0001 is attached for you.');
  });

  it('always opens with the visit summary paragraph', () => {
    const msg = composeVisitDoneMessage(base)!;
    expect(msg.paragraphs[0]).toBe(
      "Dave's Window Cleaning finished your window clean (front & back) at 12 Elm Road, SW1A 1AA on Thu 24 Sep.",
    );
  });

  it('paid now + visit paid thanks and optional credit', () => {
    const msg = composeVisitDoneMessage({
      ...base,
      paidNow: { method: 'cash', amount: 18 },
      visitStatus: 'paid',
      visitOutstanding: 0,
      customerOwedTotal: 0,
      customerCredit: 5,
      payUrl: null,
    })!;
    expect(msg.paragraphs).toContain(
      'Thanks so much for your payment of £18 by cash.',
    );
    expect(msg.paragraphs).toContain(
      "You've got £5 credit ready for next time.",
    );
    expect(msg.payUrl).toBeNull();
    expect(msg.bankLine).toBeNull();
  });

  it('credit-covered paid visit (no paidNow)', () => {
    const msg = composeVisitDoneMessage({
      ...base,
      paidNow: null,
      visitStatus: 'paid',
      visitOutstanding: 0,
      customerOwedTotal: 0,
      customerCredit: 12,
      payUrl: null,
    })!;
    expect(msg.paragraphs).toContain(
      'This visit (£18) was covered by your credit.',
    );
    expect(msg.paragraphs).toContain("You've still got £12 credit left.");
  });

  it('unpaid visit with earlier balance and bank line', () => {
    const msg = composeVisitDoneMessage({
      ...base,
      visitStatus: 'unpaid',
      visitOutstanding: 18,
      customerOwedTotal: 40,
    })!;
    expect(msg.paragraphs).toContain(
      "There's £18 to pay for this visit whenever you're ready.",
    );
    expect(msg.paragraphs).toContain(
      'Including earlier visits, that comes to £40 in total.',
    );
    expect(msg.payUrl).toBe(base.payUrl);
    expect(msg.bankLine).toBe(
      "You can also pay by bank transfer: Dave's Window Cleaning, sort code 12-34-56, account 12345678, reference SMITH12.",
    );
  });

  it('paid now but still partial: thanks then outstanding', () => {
    const msg = composeVisitDoneMessage({
      ...base,
      paidNow: { method: 'cheque', amount: 10 },
      visitStatus: 'partial',
      visitOutstanding: 5,
      customerOwedTotal: 5,
    })!;
    expect(msg.paragraphs).toContain(
      'Thanks so much for your payment of £10 by cheque.',
    );
    expect(msg.paragraphs).toContain(
      "There's £5 to pay for this visit whenever you're ready.",
    );
    expect(msg.payUrl).toBe(base.payUrl);
  });

  it('omits reference from bankLine when null; null bank → null bankLine', () => {
    const noRef = composeVisitDoneMessage({
      ...base,
      reference: null,
    })!;
    expect(noRef.bankLine).toBe(
      "You can also pay by bank transfer: Dave's Window Cleaning, sort code 12-34-56, account 12345678.",
    );
    const noBank = composeVisitDoneMessage({ ...base, bank: null })!;
    expect(noBank.bankLine).toBeNull();
  });

  it('ends with a friendly reply prompt and business sign-off', () => {
    const msg = composeVisitDoneMessage(base)!;
    expect(msg.paragraphs.at(-1)).toBe(
      'Any questions? Just reply to this email — happy to help.',
    );
    expect(msg.signOff).toBe("Thanks,\nDave's Window Cleaning");
  });
});

describe('composePaymentReceivedMessage', () => {
  const base = {
    businessName: "Dave's Window Cleaning",
    customerName: 'Sarah Smith',
    amount: 15,
    method: 'bank_transfer' as const,
    customerOwedTotal: 0,
    customerCredit: 0,
    payUrl: 'https://app.joinworkwise.com/pay/tok',
    bank: {
      accountName: "Dave's Window Cleaning",
      sortCode: '123456',
      accountNumber: '12345678',
    },
    reference: 'SMITH12',
  };

  it('thanks for the payment and says all paid up', () => {
    const msg = composePaymentReceivedMessage(base);
    expect(msg.subject).toBe(
      "Thanks for your payment — Dave's Window Cleaning",
    );
    expect(msg.greeting).toBe('Hi Sarah,');
    expect(msg.paragraphs).toEqual([
      'Thanks so much for your payment of £15 by bank transfer.',
      "You're all paid up — thank you!",
      'Any questions? Just reply to this email — happy to help.',
    ]);
    expect(msg.payUrl).toBeNull();
    expect(msg.bankLine).toBeNull();
  });

  it('mentions remaining credit when all paid', () => {
    const msg = composePaymentReceivedMessage({
      ...base,
      method: 'cash',
      customerCredit: 5,
    });
    expect(msg.paragraphs).toContain(
      "You've got £5 credit ready for next time.",
    );
  });

  it('shows remaining balance with pay link when not cleared', () => {
    const msg = composePaymentReceivedMessage({
      ...base,
      method: 'cheque',
      amount: 10,
      customerOwedTotal: 5,
    });
    expect(msg.paragraphs).toContain(
      "That leaves £5 still to pay whenever you're ready.",
    );
    expect(msg.payUrl).toBe('https://app.joinworkwise.com/pay/tok');
    expect(msg.bankLine).toContain('You can also pay by bank transfer:');
    expect(msg.bankLine).toContain('reference SMITH12');
  });
});

describe('composeShareMessage', () => {
  it('all paid up when owedTotal <= 0', () => {
    expect(
      composeShareMessage({
        businessName: "Dave's Window Cleaning",
        customerName: 'Sarah Smith',
        owedTotal: 0,
        unpaidVisits: 0,
        payUrl: 'https://app.joinworkwise.com/pay/tok',
        bank: null,
        reference: null,
      }),
    ).toBe(
      "Hi Sarah, it's Dave's Window Cleaning. You're all paid up — thank you!",
    );
  });

  it('includes pay URL and optional bank details', () => {
    const msg = composeShareMessage({
      businessName: "Dave's Window Cleaning",
      customerName: 'Sarah Smith',
      owedTotal: 40,
      unpaidVisits: 2,
      payUrl: 'https://app.joinworkwise.com/pay/tok',
      bank: {
        accountName: 'Dave',
        sortCode: '123456',
        accountNumber: '12345678',
      },
      reference: 'SMITH12',
    });
    expect(msg).toContain("There's £40 to pay for 2 visits");
    expect(msg).toContain('Pay online: https://app.joinworkwise.com/pay/tok');
    expect(msg).toContain(
      'or by bank transfer to 12-34-56 12345678, ref SMITH12',
    );
    expect(msg.length).toBeLessThanOrEqual(320);
  });

  it('stays ≤ 320 chars with a long business name', () => {
    const msg = composeShareMessage({
      businessName:
        'Super Long Sparkling Window Cleaning And Gutter Clearance Services Ltd',
      customerName: 'Sarah Smith',
      owedTotal: 1250.5,
      unpaidVisits: 12,
      payUrl:
        'https://app.joinworkwise.com/pay/abcdefghijklmnopqrstuvwxyz012345',
      bank: {
        accountName: 'Long',
        sortCode: '123456',
        accountNumber: '12345678',
      },
      reference: 'SMITH99',
    });
    expect(msg.length).toBeLessThanOrEqual(320);
  });
});
