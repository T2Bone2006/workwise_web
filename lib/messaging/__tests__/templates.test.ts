import { describe, expect, it } from 'vitest';
import { countSegments, isGsm7 } from '@/lib/messaging/gsm';
import {
  UNKNOWN_NUMBER_SMS,
  afterAllSms,
  chaserSms,
  dayMovedSms,
  daySkippedSms,
  fitSms,
  paymentReceivedSms,
  reminderSms,
  replyMoveAckSms,
  replySkipAckSms,
  serviceLabel,
  shortAddress,
  shortBusinessName,
  timeLabel,
  visitDoneSms,
  type SmsBrand,
} from '@/lib/messaging/templates';
import {
  composeVisitDoneSms,
  formatVisitDay,
  type VisitDoneMessageInput,
} from '@/lib/payments/messages';

const WORST_BIZ = 'Crystal Clear Window Cleaning Services Ltd';
const WORST_ADDR =
  'Flat 12B, The Old Rectory Cottages, Long Lane, Upper Slaughter';
const WORST_SERVICES = ['Window clean', 'Gutters', 'Conservatory roof'];
const WORST_PHONE = '+447700900123';
const WORST_URL = `https://app.joinworkwise.com/pay/${'a'.repeat(32)}`;
const WORST_INVOICE_URL = `https://app.joinworkwise.com/pay/i/${'a'.repeat(32)}`;
const WORST_AMOUNT = 1234.56;
const WORST_DAY = 'Wed 30 Sep';

const worstBrand: SmsBrand = {
  businessName: WORST_BIZ,
  contactPhone: WORST_PHONE,
};

function expectOneSegment(text: string) {
  expect(isGsm7(text)).toBe(true);
  expect(countSegments(text).segments).toBe(1);
  expect(text.toLowerCase()).not.toContain('reply yes');
  expect(text).not.toContain('  ');
}

describe('short helpers', () => {
  it('shortens a long business name at a word boundary', () => {
    const name = shortBusinessName(WORST_BIZ);
    expect(name).toBe('Crystal Clear Window Cleaning');
    expect([...name].length).toBeLessThanOrEqual(30);
    expect(name.endsWith('...')).toBe(false);
    expect(shortBusinessName("Dave's Windows")).toBe("Dave's Windows");
  });

  it('keeps the first part of an address', () => {
    expect(shortAddress('12 Elm Road, Leeds')).toBe('12 Elm Road');
    expect(shortAddress(WORST_ADDR)).toBe('Flat 12B');
  });

  it('joins service titles and collapses a long list to visit', () => {
    expect(serviceLabel(['Window clean'])).toBe('window clean');
    expect(serviceLabel(['Window clean', 'Gutters'])).toBe(
      'window clean and gutters',
    );
    expect(serviceLabel(WORST_SERVICES)).toBe('visit');
  });

  it('formats a clock time for a text', () => {
    expect(timeLabel('09:30')).toBe('around 9:30am');
    expect(timeLabel('14:00')).toBe('around 2pm');
    expect(timeLabel(null)).toBeNull();
    expect(timeLabel('25:00')).toBeNull();
    expect(timeLabel('9:30')).toBeNull();
  });
});

describe('fitSms', () => {
  it('drops the lowest drop number first and joins a period without a space', () => {
    const required = 'R'.repeat(151);
    const text = fitSms([
      { text: required },
      { text: 'BBBBB', drop: 2 },
      { text: 'CCC', drop: 1 },
    ]);
    expect(text).toBe(`${required} BBBBB`);

    expect(
      fitSms([{ text: 'Hello' }, { text: '.', glue: 'none' }]),
    ).toBe('Hello.');
  });

  it('throws when required text is still too long', () => {
    expect(() => fitSms([{ text: 'R'.repeat(161) }])).toThrow(/fitSms/);
  });
});

describe('worst-case length', () => {
  const texts: Array<[string, string]> = [
    [
      'reminder',
      reminderSms({
        brand: worstBrand,
        address: WORST_ADDR,
        day: WORST_DAY,
        services: WORST_SERVICES,
        time: null,
        firstText: true,
      }),
    ],
    [
      'visit done to pay',
      visitDoneSms({
        brand: worstBrand,
        services: WORST_SERVICES,
        address: WORST_ADDR,
        dayLabel: WORST_DAY,
        outcome: { kind: 'to_pay', amount: WORST_AMOUNT, payUrl: WORST_URL },
      }),
    ],
    [
      'visit done invoice',
      visitDoneSms({
        brand: worstBrand,
        services: WORST_SERVICES,
        address: WORST_ADDR,
        dayLabel: WORST_DAY,
        outcome: {
          kind: 'invoice',
          number: 'INV-0042',
          amount: WORST_AMOUNT,
          invoiceUrl: WORST_INVOICE_URL,
        },
      }),
    ],
    [
      'visit done paid now',
      visitDoneSms({
        brand: worstBrand,
        services: WORST_SERVICES,
        address: WORST_ADDR,
        dayLabel: WORST_DAY,
        outcome: {
          kind: 'paid_now',
          amount: WORST_AMOUNT,
          method: 'cash',
          creditLeft: WORST_AMOUNT,
        },
      }),
    ],
    [
      'visit done paid by credit',
      visitDoneSms({
        brand: worstBrand,
        services: WORST_SERVICES,
        address: WORST_ADDR,
        dayLabel: WORST_DAY,
        outcome: { kind: 'paid_by_credit', creditLeft: WORST_AMOUNT },
      }),
    ],
    [
      'chaser stage 1',
      chaserSms({
        brand: worstBrand,
        owed: WORST_AMOUNT,
        payUrl: WORST_URL,
        stage: 1,
      }),
    ],
    [
      'chaser stage 2',
      chaserSms({
        brand: worstBrand,
        owed: WORST_AMOUNT,
        payUrl: WORST_URL,
        stage: 2,
      }),
    ],
    [
      'payment received',
      paymentReceivedSms({
        brand: worstBrand,
        amount: WORST_AMOUNT,
        methodLabel: 'cash',
        owedLeft: WORST_AMOUNT,
        payUrl: WORST_URL,
        creditLeft: WORST_AMOUNT,
      }),
    ],
    [
      'day moved',
      dayMovedSms({
        brand: worstBrand,
        fromDay: WORST_DAY,
        toDay: WORST_DAY,
      }),
    ],
    [
      'day skipped',
      daySkippedSms({
        brand: worstBrand,
        day: WORST_DAY,
        nextDay: WORST_DAY,
      }),
    ],
    [
      'after all',
      afterAllSms({ brand: worstBrand, day: WORST_DAY }),
    ],
    [
      'reply skip ack',
      replySkipAckSms({
        brand: worstBrand,
        day: WORST_DAY,
        nextDay: WORST_DAY,
      }),
    ],
    [
      'reply move ack',
      replyMoveAckSms({ brand: worstBrand, toDay: WORST_DAY }),
    ],
    ['unknown number', UNKNOWN_NUMBER_SMS],
  ];

  // Money texts keep the trader's number even if that makes two segments.
  const MONEY = new Set([
    'visit done to pay',
    'visit done invoice',
    'visit done paid now',
    'visit done paid by credit',
    'chaser stage 1',
    'chaser stage 2',
    'payment received',
  ]);

  it.each(texts.filter(([name]) => !MONEY.has(name)))('%s is one GSM-7 segment', (_name, text) => {
    expectOneSegment(text);
  });

  it.each(texts.filter(([name]) => MONEY.has(name)))(
    '%s keeps Questions? Call in at most two segments',
    (_name, text) => {
      expect(isGsm7(text)).toBe(true);
      expect(countSegments(text).segments).toBeLessThanOrEqual(2);
      expect(text).toContain('Questions? Call 07700 900123');
      expect(text).not.toContain('  ');
    },
  );

  it('keeps Reply NO and Reply STOP on the first reminder', () => {
    const text = texts[0]?.[1] ?? '';
    expect(text).toContain('Reply NO');
    expect(text).toContain('Reply STOP to opt out.');
  });
});

describe('short reminder', () => {
  it('drops nothing optional', () => {
    const text = reminderSms({
      brand: { businessName: "Dave's Windows", contactPhone: WORST_PHONE },
      address: '12 Elm Rd',
      day: 'Thu 2 Oct',
      services: ['Window clean'],
      time: '09:30',
      firstText: false,
    });
    expect(text).toBe(
      "Dave's Windows: we're due at 12 Elm Rd on Thu 2 Oct around 9:30am for your window clean. Reply NO if that's a problem. Questions? Call 07700 900123",
    );
  });
});

describe('money texts with a short name', () => {
  const brand: SmsBrand = { businessName: "Dave's Windows", contactPhone: WORST_PHONE };
  const payUrl = `https://app.joinworkwise.com/pay/${'a'.repeat(32)}`;

  it('stays one segment and still has the trader number', () => {
    const texts = [
      chaserSms({ brand, owed: 15, payUrl, stage: 1 }),
      chaserSms({ brand, owed: 15, payUrl, stage: 2 }),
      visitDoneSms({
        brand,
        services: ['Window clean'],
        address: '12 Elm Rd',
        dayLabel: null,
        outcome: { kind: 'to_pay', amount: 15, payUrl },
      }),
      paymentReceivedSms({
        brand,
        amount: 15,
        methodLabel: 'cash',
        owedLeft: 0,
        payUrl: null,
        creditLeft: 0,
      }),
    ];
    for (const text of texts) {
      expect(countSegments(text).segments).toBe(1);
      expect(text).toContain('Questions? Call 07700 900123');
    }
  });
});

describe('missing trader phone', () => {
  const brand: SmsBrand = { businessName: "Dave's Windows", contactPhone: null };

  const texts = [
    reminderSms({
      brand,
      address: '12 Elm Rd',
      day: 'Thu 2 Oct',
      services: ['Window clean'],
      time: '09:30',
      firstText: true,
    }),
    dayMovedSms({ brand, fromDay: 'Thu 2 Oct', toDay: 'Mon 6 Oct' }),
    daySkippedSms({ brand, day: 'Thu 2 Oct', nextDay: 'Thu 30 Oct' }),
    daySkippedSms({ brand, day: 'Thu 2 Oct', nextDay: null }),
    afterAllSms({ brand, day: 'Thu 2 Oct' }),
    replySkipAckSms({ brand, day: 'Thu 2 Oct', nextDay: null }),
    replyMoveAckSms({ brand, toDay: 'Fri 3 Oct' }),
  ];

  it('omits Questions? Call and leaves no double spaces', () => {
    for (const text of texts) {
      expect(text).not.toContain('Questions? Call');
      expect(text).not.toContain('  ');
    }
  });
});

describe('GSM-7 cleanup', () => {
  it('straightens a curly apostrophe and drops an emoji in the business name', () => {
    const text = reminderSms({
      brand: { businessName: 'Dave’s 😀 Windows', contactPhone: null },
      address: '12 Elm Rd',
      day: 'Thu 2 Oct',
      services: ['Window clean'],
      time: null,
      firstText: false,
    });
    expect(text.startsWith("Dave's Windows:")).toBe(true);
    expect(text).not.toContain('😀');
    expect(isGsm7(text)).toBe(true);
  });
});

describe('composeVisitDoneSms', () => {
  const payUrl = `https://app.joinworkwise.com/pay/${'b'.repeat(32)}`;
  const invoiceUrl = `https://app.joinworkwise.com/pay/i/${'b'.repeat(32)}`;

  function input(over: Partial<VisitDoneMessageInput> = {}): VisitDoneMessageInput {
    return {
      businessName: "Dave's Windows",
      customerName: 'Sarah Smith',
      visitDate: '2026-10-02',
      serviceTitle: 'Window clean',
      address: '12 Elm Rd',
      visitDue: 15,
      paidNow: null,
      visitStatus: 'unpaid',
      visitOutstanding: 15,
      customerOwedTotal: 15,
      customerCredit: 0,
      payUrl,
      bank: null,
      reference: null,
      invoiceNumber: null,
      directDebit: null,
      ...over,
    };
  }

  const extra = {
    services: ['Window clean'],
    visitDate: '2026-10-02',
    today: '2026-10-02',
    invoiceUrl: null as string | null,
    contactPhone: WORST_PHONE,
  };

  it('returns null when the visit was waived', () => {
    expect(
      composeVisitDoneSms(input({ visitStatus: 'waived' }), extra),
    ).toBeNull();
  });

  it('says it will be collected by Direct Debit, with no link (D8)', () => {
    const text = composeVisitDoneSms(input({ directDebit: { collectOn: 'Tue 7 Oct' }, payUrl: null }), extra);
    expect(text).toBe(
      "Dave's Windows: your window clean at 12 Elm Rd was done today. £15.00 will be collected by Direct Debit on or after Tue 7 Oct. Questions? Call 07700 900123",
    );
    expect(text).not.toContain('http');
    expect(isGsm7(text as string)).toBe(true);
    expect(countSegments(text as string).segments).toBeLessThanOrEqual(2);
  });

  it('Direct Debit wins over an invoice link; paid visits ignore it', () => {
    const dd = { collectOn: 'Tue 7 Oct' };
    const withInvoice = composeVisitDoneSms(
      input({ directDebit: dd, invoiceNumber: 'INV-7' }),
      { ...extra, invoiceUrl },
    );
    expect(withInvoice).toContain('will be collected by Direct Debit');
    expect(withInvoice).not.toContain(invoiceUrl);
    const paid = composeVisitDoneSms(
      input({ directDebit: dd, visitStatus: 'paid', paidNow: { method: 'cash', amount: 15 } }),
      extra,
    );
    expect(paid).not.toContain('Direct Debit');
  });

  it('uses to_pay for an unpaid visit', () => {
    const text = composeVisitDoneSms(input(), extra);
    expect(text).toContain('£15 to pay:');
    expect(text).toContain(payUrl);
    expect(text).toContain('done today');
    expect(text).not.toContain('Invoice');
  });

  it('uses the outstanding amount for a partial visit', () => {
    const text = composeVisitDoneSms(
      input({ visitStatus: 'partial', visitOutstanding: 10, visitDue: 15 }),
      { ...extra, today: '2026-09-01' },
    );
    expect(text).toContain('£10 to pay:');
    expect(text).toContain(`done on ${formatVisitDay('2026-10-02')}`);
  });

  it('thanks them when they paid cash on the visit', () => {
    const text = composeVisitDoneSms(
      input({
        visitStatus: 'paid',
        visitOutstanding: 0,
        paidNow: { method: 'cash', amount: 15 },
        customerCredit: 3,
      }),
      extra,
    );
    expect(text).toContain('Thanks for the £15 cash!');
    expect(text).toContain("You've £3 credit for next time.");
  });

  it('says the visit was paid from credit', () => {
    const text = composeVisitDoneSms(
      input({
        visitStatus: 'paid',
        visitOutstanding: 0,
        visitDue: 15,
        customerCredit: 3,
        payUrl: null,
      }),
      extra,
    );
    expect(text).toContain('paid from your credit');
    expect(text).toContain('(£3 left)');
  });

  it('sends the invoice variant with the outstanding, or the visit price when nothing is outstanding', () => {
    const owing = composeVisitDoneSms(
      input({ invoiceNumber: 'INV-0042', visitOutstanding: 10, visitDue: 15 }),
      { ...extra, invoiceUrl },
    );
    expect(owing).toContain('Invoice INV-0042 for £10:');
    expect(owing).toContain(invoiceUrl);

    const settled = composeVisitDoneSms(
      input({
        invoiceNumber: 'INV-0042',
        visitStatus: 'paid',
        visitOutstanding: 0,
        visitDue: 15,
      }),
      { ...extra, invoiceUrl },
    );
    expect(settled).toContain('Invoice INV-0042 for £15:');
  });

  it('throws when something is owed and there is no pay link', () => {
    expect(() =>
      composeVisitDoneSms(input({ payUrl: null }), extra),
    ).toThrow('composeVisitDoneSms: payUrl required when something is owed');
  });
});
