import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  intents: null as Row | null,
  partners: null as Row | null,
  inserted: null as Row | null,
  insertError: null as { code?: string } | null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
}));

import { countedInvoice, recordPartnerReferral, subscriptionIdOfInvoice } from '@/lib/billing/partner-referrals';

function admin() {
  return {
    from(table: string) {
      if (table === 'signup_intents') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: tables.intents, error: null }),
            }),
          }),
        };
      }
      if (table === 'referral_partners') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: tables.partners, error: null }),
            }),
          }),
        };
      }
      if (table === 'partner_referrals') {
        return {
          insert: async (row: Row) => {
            tables.inserted = row;
            return { error: tables.insertError };
          },
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
}

describe('recordPartnerReferral', () => {
  beforeEach(() => {
    tables.intents = null;
    tables.partners = null;
    tables.inserted = null;
    tables.insertError = null;
  });

  it('does nothing when the signup was not a partner', async () => {
    tables.intents = { partner_id: null, referrer_tenant_id: null };
    await recordPartnerReferral({ admin: admin() as never, intentId: 'intent-1', tenantId: 'ten-1' });
    expect(tables.inserted).toBeNull();
  });

  it('does nothing when a customer referral is already on the signup', async () => {
    tables.intents = { partner_id: 'par-1', referrer_tenant_id: 'ten-ref' };
    await recordPartnerReferral({ admin: admin() as never, intentId: 'intent-1', tenantId: 'ten-1' });
    expect(tables.inserted).toBeNull();
  });

  it('stores the business against the partner for twelve months', async () => {
    tables.intents = { partner_id: 'par-1', referrer_tenant_id: null };
    tables.partners = { code: 'SARAH' };
    await recordPartnerReferral({ admin: admin() as never, intentId: 'intent-1', tenantId: 'ten-1' });
    expect(tables.inserted).toMatchObject({
      partner_id: 'par-1',
      referred_tenant_id: 'ten-1',
      signup_intent_id: 'intent-1',
      code: 'SARAH',
    });
    const started = new Date(String(tables.inserted?.started_at));
    const ends = new Date(String(tables.inserted?.window_ends_at));
    expect(ends.getUTCMonth()).toBe(started.getUTCMonth());
    expect(ends.getUTCFullYear()).toBe(started.getUTCFullYear() + 1);
  });

  it('treats a second run for the same business as already recorded', async () => {
    tables.intents = { partner_id: 'par-1', referrer_tenant_id: null };
    tables.partners = { code: 'SARAH' };
    tables.insertError = { code: '23505' };
    await expect(
      recordPartnerReferral({ admin: admin() as never, intentId: 'intent-1', tenantId: 'ten-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('subscription invoices', () => {
  it('reads the subscription from the current invoice shape and ignores a text pack', () => {
    const subscription = {
      parent: { subscription_details: { subscription: 'sub_1' }, quote_details: null, type: 'subscription_details' },
      amount_paid: 3500,
      post_payment_credit_notes_amount: 0,
      status: 'paid',
      created: 1,
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdOfInvoice(subscription)).toBe('sub_1');
    expect(countedInvoice(subscription)).toMatchObject({ amountPaid: 3500, subscriptionId: 'sub_1' });

    const refunded = {
      ...subscription,
      amount_paid: 3500,
      post_payment_credit_notes_amount: 3500,
    } as unknown as Stripe.Invoice;
    expect(countedInvoice(refunded).amountPaid).toBe(0);

    const pack = { parent: null, amount_paid: 500, status: 'paid', created: 1 } as unknown as Stripe.Invoice;
    expect(subscriptionIdOfInvoice(pack)).toBeNull();
  });
});
