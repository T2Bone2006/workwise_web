import { describe, expect, it } from 'vitest';
import { composeDirectDebitFailed, composeDirectDebitInvite } from '@/lib/direct-debit/messages';
import { countSegments } from '@/lib/messaging/gsm';

const url = `https://app.joinworkwise.com/pay/${'a'.repeat(32)}?dd=1`;

describe('composeDirectDebitInvite', () => {
  it('with an amount owed and a phone', () => {
    const invite = composeDirectDebitInvite({
      businessName: 'Sparkle Windows',
      customerName: 'Mrs Jane Wright',
      url,
      contactPhone: '+447700900123',
      owedNow: 15,
    });
    expect(invite.subject).toBe('Sparkle Windows: pay by Direct Debit');
    expect(invite.greeting).toBe('Hello,');
    expect(invite.emailParagraphs).toEqual([
      "Sparkle Windows can now take payment by Direct Debit after each visit, so there's nothing to remember.",
      "Setting it up takes 2 minutes on GoCardless's secure page:",
      'The £15.00 you owe now will be collected first.',
      "You'll get an email before every payment, and you're protected by the Direct Debit Guarantee — you can cancel any time with your bank.",
    ]);
    expect(invite.sms).toBe(
      `Sparkle Windows: pay automatically by Direct Debit after each visit. Set up in 2 mins: ${url} Questions? Call 07700 900123`,
    );
    expect(countSegments(invite.sms).segments).toBeLessThanOrEqual(2);
    expect(invite.share).toBe(
      `Hi there, you can now pay Sparkle Windows by Direct Debit after each visit — set it up here: ${url}`,
    );
  });

  it('nothing owed and no phone', () => {
    const invite = composeDirectDebitInvite({
      businessName: 'Sparkle Windows',
      customerName: 'Jane Wright',
      url,
      contactPhone: null,
      owedNow: 0,
    });
    expect(invite.greeting).toBe('Hi Jane,');
    expect(invite.emailParagraphs).toHaveLength(3);
    expect(invite.emailParagraphs.join(' ')).not.toContain('owe now');
    expect(invite.sms).toBe(
      `Sparkle Windows: pay automatically by Direct Debit after each visit. Set up in 2 mins: ${url}`,
    );
    expect(invite.share.startsWith('Hi Jane, you can now pay Sparkle Windows')).toBe(true);
  });

  it('a very long business name still fits two texts', () => {
    const invite = composeDirectDebitInvite({
      businessName: 'The Extremely Long Window Cleaning Company of Greater Manchester Ltd',
      customerName: 'Jane Wright',
      url,
      contactPhone: '+447700900123',
      owedNow: 0,
    });
    expect(countSegments(invite.sms).segments).toBeLessThanOrEqual(2);
    expect(invite.sms).toContain('Questions? Call 07700 900123');
  });
});

describe('composeDirectDebitFailed', () => {
  const payUrl = `https://app.joinworkwise.com/pay/${'a'.repeat(32)}`;

  it('still active, with a phone', () => {
    const m = composeDirectDebitFailed({
      businessName: 'Sparkle Windows',
      customerName: 'Mrs Jane Wright',
      amount: 15,
      payUrl,
      contactPhone: '+447700900123',
      stillActive: true,
    });
    expect(m.subject).toBe('Sparkle Windows: payment not collected');
    expect(m.greeting).toBe('Hello,'); // "Mrs" is a title, so no first name
    expect(m.emailParagraphs).toEqual([
      "We tried to collect £15.00 by Direct Debit, but your bank didn't pay it.",
      'You can pay here instead:',
    ]);
    expect(m.afterButton).toEqual(["If you've already paid, thank you — please ignore this."]);
    expect(m.sms).toBe(
      `Sparkle Windows: we couldn't collect £15.00 by Direct Debit. Pay here: ${payUrl} Questions? Call 07700 900123`,
    );
  });

  it('no longer active, no phone', () => {
    const m = composeDirectDebitFailed({
      businessName: 'Sparkle Windows',
      customerName: 'Jane Wright',
      amount: 12.5,
      payUrl,
      contactPhone: null,
      stillActive: false,
    });
    expect(m.afterButton).toEqual([
      'Your Direct Debit with Sparkle Windows is no longer active. You can set it up again from the same page.',
      "If you've already paid, thank you — please ignore this.",
    ]);
    expect(m.emailParagraphs[0]).toContain('£12.50');
    expect(m.sms).toBe(`Sparkle Windows: we couldn't collect £12.50 by Direct Debit. Pay here: ${payUrl}`);
  });

  it('a very long business name still fits two texts', () => {
    const m = composeDirectDebitFailed({
      businessName: 'The Extremely Long Window Cleaning Company of Greater Manchester Ltd',
      customerName: 'Jane Wright',
      amount: 15,
      payUrl,
      contactPhone: '+447700900123',
      stillActive: true,
    });
    expect(countSegments(m.sms).segments).toBeLessThanOrEqual(2);
  });
});
