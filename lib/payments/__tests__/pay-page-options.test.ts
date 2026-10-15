import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardPayButton } from '@/components/pay/card-pay-button';
import { DirectDebitOffer } from '@/components/pay/direct-debit-offer';
import { PayByBankButton, payByBankBanner } from '@/components/pay/pay-by-bank-button';

const none = { available: true, status: 'none' as const, bankEnding: null };

describe('pay page options (step 19d)', () => {
  it('Pay by bank posts only the token, where from and the kind — never an amount', () => {
    const html = renderToStaticMarkup(
      createElement(PayByBankButton, { token: 'tok', from: 'invoice', amount: 15 }),
    );
    expect(html).toContain('action="/api/pay/bank"');
    expect(html).toContain('name="from" value="invoice"');
    expect(html).toContain('name="kind" value="pay_by_bank"');
    expect(html).not.toContain('name="amount"');
    expect(html).toContain('Pay £15.00 by bank');
    expect(html).toContain('Approve it in your banking app — no card needed.');
  });

  it('the card button says by card, with the wallet line', () => {
    const html = renderToStaticMarkup(
      createElement(CardPayButton, { token: 'tok', kind: 'customer', amount: 15 }),
    );
    expect(html).toContain('Pay £15.00 by card');
    expect(html).toContain('Card, Apple Pay or Google Pay');
  });

  it('the Direct Debit offer adds "pay now and set up" only when asked', () => {
    const offer = (canPayNow: boolean) =>
      renderToStaticMarkup(
        createElement(DirectDebitOffer, {
          token: 'tok',
          businessName: 'Sparkle',
          owedAmount: 15,
          directDebit: none,
          highlighted: false,
          canPayNow,
        }),
      );
    const withPayNow = offer(true);
    expect(withPayNow).toContain('Set up Direct Debit');
    expect(withPayNow).toContain('name="kind" value="pay_and_dd"');
    expect(withPayNow).toContain('Pay the £15.00 now by bank and set up Direct Debit');
    expect(offer(false)).not.toContain('pay_and_dd');
  });

  it('the return banners follow step 19a, and unknown codes show nothing', () => {
    expect(payByBankBanner('done')?.tone).toBe('good');
    expect(payByBankBanner('cancelled')?.text).toBe('No problem — nothing was paid.');
    expect(payByBankBanner('provider_error')?.tone).toBe('warn');
    expect(payByBankBanner('nope')).toBeNull();
    expect(payByBankBanner(undefined)).toBeNull();
  });
});
