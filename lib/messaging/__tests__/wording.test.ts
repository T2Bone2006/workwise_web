import { describe, expect, it } from 'vitest';
import { countSegments } from '@/lib/messaging/gsm';
import {
  messageWordingPreview,
  reminderSms,
  visitDoneSms,
  type SmsBrand,
} from '@/lib/messaging/templates';
import {
  checkWordingShape,
  insertWordingToken,
  matchingWordingTokens,
  STANDARD_WORDING,
  WORDING_KEYS,
  wordingCatalogue,
  wordingTokenQuery,
} from '@/lib/messaging/wording';

const brand: SmsBrand = { businessName: "Dave's Windows", contactPhone: '+447700900123' };
const payUrl = `https://app.joinworkwise.com/pay/${'a'.repeat(32)}`;
const invoiceUrl = `https://app.joinworkwise.com/pay/i/${'a'.repeat(32)}`;

describe('standard wording matches the built-in texts', () => {
  it('reminder example is the first text that is actually sent', () => {
    const first = messageWordingPreview('reminder', STANDARD_WORDING.reminder, brand);
    expect(first.text).toBe(
      reminderSms({
        brand,
        address: '12 Elm Rd',
        day: 'Thu 2 Oct',
        services: ['Window clean'],
        time: '09:30',
        firstText: true,
      }),
    );
    expect(first.text).toContain('Reply NO');
    expect(first.text.match(/Reply STOP/g)).toHaveLength(1);
    expect(first.error).toBeNull();
    expect(first.segments).toBe(1);
  });

  it('each visit-done example is the text that is actually sent', () => {
    const samples = [
      ['visit_done_to_pay', { kind: 'to_pay', amount: 15, payUrl }] as const,
      [
        'visit_done_paid_now',
        { kind: 'paid_now', amount: 15, method: 'cash', creditLeft: 3 },
      ] as const,
      ['visit_done_paid_credit', { kind: 'paid_by_credit', creditLeft: 3 }] as const,
      [
        'visit_done_invoice',
        { kind: 'invoice', number: 'INV-0042', amount: 15, invoiceUrl },
      ] as const,
      [
        'visit_done_direct_debit',
        { kind: 'direct_debit', amount: 15, collectOn: 'Tue 7 Oct' },
      ] as const,
    ];
    for (const [key, outcome] of samples) {
      const preview = messageWordingPreview(key, STANDARD_WORDING[key], brand);
      expect(preview.text).toBe(
        visitDoneSms({
          brand,
          services: ['Window clean'],
          address: '12 Elm Rd',
          dayLabel: null,
          outcome,
        }),
      );
      expect(preview.error).toBeNull();
      expect(preview.segments).toBeLessThanOrEqual(2);
    }
  });
});

describe('wording pieces', () => {
  it('inserts a piece at the caret, with spaces, and finishes a half-typed brace', () => {
    const line = "we're coming on";
    expect(insertWordingToken(line, line.length, 'date')).toEqual({
      value: `${line} {date}`,
      caret: `${line} {date}`.length,
    });
    expect(insertWordingToken(`${line} Thursday`, line.length, 'date').value).toBe(
      `${line} {date} Thursday`,
    );
    expect(insertWordingToken('See you {da', 'See you {da'.length, 'date')).toEqual({
      value: 'See you {date}',
      caret: 'See you {date}'.length,
    });
  });

  it('suggests pieces from the letters after an open brace', () => {
    expect(wordingTokenQuery("we're coming on {")).toBe('');
    expect(wordingTokenQuery("we're coming on {da")).toBe('da');
    expect(wordingTokenQuery('done {date}.')).toBeNull();
    expect(matchingWordingTokens('da', ['date', 'address', 'job'])).toEqual(['date']);
    expect(matchingWordingTokens('link', ['pay_link', 'invoice_link', 'amount'])).toEqual([
      'pay_link',
      'invoice_link',
    ]);
    expect(matchingWordingTokens('day', ['date', 'collect_on'])).toEqual(['collect_on']);
  });

  it('lists the six messages for the phone', () => {
    const list = wordingCatalogue();
    expect(list.map((item) => item.key)).toEqual([...WORDING_KEYS]);
    const reminder = list[0];
    expect(reminder?.standard).toBe(STANDARD_WORDING.reminder);
    expect(reminder?.pieces.some((piece) => piece.token === 'business' && piece.required)).toBe(
      true,
    );
    expect(reminder?.pieces.some((piece) => piece.token === 'address' && !piece.required)).toBe(
      true,
    );
    expect(reminder?.pieces.some((piece) => piece.token === 'date' && !piece.required)).toBe(true);
    expect(list.every((item) => item.pieces.some((piece) => piece.token === 'address' && !piece.required))).toBe(
      true,
    );
    expect(list.every((item) => item.pieces.some((piece) => piece.token === 'date' && !piece.required))).toBe(
      true,
    );
  });
});

describe('custom wording', () => {
  it('sends their reminder and keeps Reply NO and STOP', () => {
    const text = reminderSms({
      brand,
      address: '12 Elm Rd',
      day: 'Thu 2 Oct',
      services: ['Window clean'],
      time: '09:30',
      firstText: true,
      wording: 'Hi, {business} here. {address} on {date} {time} for your {job}. Reply NO. Call {phone}',
    });
    expect(text.startsWith("Hi, Dave's Windows here.")).toBe(true);
    expect(text).toContain('Reply NO');
    expect(text.endsWith('Reply STOP to opt out.')).toBe(true);
    expect(text.match(/Reply STOP/g)).toHaveLength(1);
  });

  it('leaves out the phone line when there is no number', () => {
    const text = reminderSms({
      brand: { businessName: "Dave's Windows", contactPhone: null },
      address: '12 Elm Rd',
      day: 'Thu 2 Oct',
      services: ['Window clean'],
      time: null,
      firstText: false,
      wording: STANDARD_WORDING.reminder,
    });
    expect(text).not.toContain('Questions? Call');
    expect(text).not.toContain('  ');
  });

  it('falls back to the standard reminder when theirs cannot fit in 2 texts', () => {
    const text = reminderSms({
      brand,
      address: '12 Elm Rd',
      day: 'Thu 2 Oct',
      services: ['Window clean'],
      time: null,
      firstText: false,
      wording: `${'Hello '.repeat(80)}{business} {address} {date} {job} Reply NO`,
    });
    expect(text).toContain("we're due at");
    expect(countSegments(text).segments).toBeLessThanOrEqual(1);
  });

  it('lets the address and the date come out', () => {
    expect(checkWordingShape('reminder', 'Hi {business}, for your {job}. Reply NO')).toBeNull();
    expect(checkWordingShape('reminder', 'See you at {address} on {date}. Reply NO')).toMatch(
      /\{business\}/,
    );
    expect(
      messageWordingPreview(
        'visit_done_to_pay',
        '{business}: your {job} is done. {amount} to pay: {pay_link} Questions? Call {phone}',
        brand,
      ).error,
    ).toBeNull();
    expect(
      messageWordingPreview(
        'visit_done_to_pay',
        '{business} {job} {address} {date} {amount} {phone}',
        brand,
      ).error,
    ).toMatch(/pay_link/);
  });

  it('refuses a reminder that drops Reply NO, invents a piece, or asks for YES', () => {
    expect(checkWordingShape('reminder', 'Hi {business} {address} {date} {job}')).toMatch(
      /Reply NO/,
    );
    expect(
      checkWordingShape('reminder', '{business} {address} {date} {job} {dog} Reply NO'),
    ).toMatch(/\{dog\}/);
    expect(
      checkWordingShape('reminder', '{business} {address} {date} {job}. Reply YES to confirm. Reply NO'),
    ).toMatch(/reply YES/i);
  });

  it('blocks a message that needs a third text', () => {
    const preview = messageWordingPreview(
      'reminder',
      `${'Please leave the side gate open. '.repeat(12)}{business} {address} {date} {job} Reply NO`,
      brand,
    );
    expect(preview.segments).toBeGreaterThan(2);
    expect(preview.error).toMatch(/2 texts/);
  });
});
