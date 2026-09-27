import { describe, expect, it } from 'vitest';
import { buildVisitDoneEmail, customerEmailFrom } from '@/lib/emails/visit-done';
import type { ComposedMessage } from '@/lib/payments/messages';

function message(payUrl: string | null): ComposedMessage {
  return {
    subject: "Dave's Window Cleaning: visit done Thu 24 Sep",
    greeting: 'Hi Sarah,',
    paragraphs: [
      "There's £15 to pay for this visit whenever you're ready.",
      'Any questions? Just reply to this email — happy to help.',
    ],
    payUrl,
    bankLine: null,
    signOff: "Thanks,\nDave's Window Cleaning",
    text: "Hi Sarah,\n\nThere's £15 to pay for this visit whenever you're ready.",
  };
}

describe('buildVisitDoneEmail', () => {
  it('escapes a business name containing <b>&', () => {
    const { html } = buildVisitDoneEmail(message(null), {
      businessName: 'Windows <b>& Doors',
      logoUrl: null,
    });
    expect(html).toContain('Windows &lt;b&gt;&amp; Doors');
    expect(html).not.toContain('Windows <b>& Doors');
  });

  it('shows the pay button only when payUrl is set', () => {
    const withPay = buildVisitDoneEmail(message('https://app.example/pay/tok'), {
      businessName: 'Dave',
      logoUrl: null,
    }).html;
    const without = buildVisitDoneEmail(message(null), {
      businessName: 'Dave',
      logoUrl: null,
    }).html;
    expect(withPay).toContain('Pay £15');
    expect(withPay).toContain('https://app.example/pay/tok');
    expect(without).not.toContain('Pay £15');
    expect(without).not.toContain('href=');
  });
});

describe('customerEmailFrom', () => {
  it('strips quotes and angle brackets', () => {
    expect(customerEmailFrom(`"Dave's" <Windows>`)).toBe(
      `"Dave's Windows via WorkWise" <noreply@joinworkwise.com>`,
    );
  });
});
