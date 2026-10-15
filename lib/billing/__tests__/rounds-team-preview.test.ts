import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }));

type Item = { id: string; price: { id: string }; quantity?: number };
const state = {
  subscription: null as null | { id: string; customer: string; status: string; items: { data: Item[] } },
  previewArgs: null as unknown,
  previewLines: [] as Array<{ amount: number; parent?: { subscription_item_details?: { proration?: boolean } } }>,
  throwPreview: false,
};
const stripe = {
  subscriptions: { retrieve: async () => state.subscription },
  invoices: {
    createPreview: async (args: unknown) => {
      if (state.throwPreview) throw new Error('boom');
      state.previewArgs = args;
      return { lines: { data: state.previewLines } };
    },
  },
};
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => stripe }));

let db: import('../../team/__tests__/fake-db').FakeDb;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));

import { fakeDb } from '../../team/__tests__/fake-db';
import { previewRoundsTeamCharge } from '@/lib/billing/rounds-team-preview';

const T = 't1';
const PLAN_M = { id: 'si_plan', price: { id: 'price_rounds_m' }, quantity: 1 };
const PLAN_Y = { id: 'si_plan', price: { id: 'price_rounds_y' }, quantity: 1 };

beforeEach(() => {
  process.env.STRIPE_PRICE_ROUNDS = 'price_rounds_m';
  process.env.STRIPE_PRICE_ROUNDS_YEARLY = 'price_rounds_y';
  process.env.STRIPE_PRICE_ROUNDS_TEAM_MONTHLY = 'price_team_m';
  process.env.STRIPE_PRICE_ROUNDS_TEAM_YEARLY = 'price_team_y';
  state.previewArgs = null;
  state.previewLines = [];
  state.throwPreview = false;
  db = fakeDb({
    subscriptions: [{ tenant_id: T, product: 'rounds', status: 'active', source: 'stripe', stripe_subscription_id: 'sub_1' }],
    team_people: [{ id: 'p0', tenant_id: T, kind: 'lead', worker_id: 'w0', ended_at: null }],
    workers: [{ id: 'w0', invite_status: 'accepted' }],
  });
  state.subscription = { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [PLAN_M] } };
});

describe('previewRoundsTeamCharge', () => {
  it('monthly: the plain price, no figure for today', async () => {
    expect(await previewRoundsTeamCharge(T, 1, db.client)).toEqual({
      ok: true,
      interval: 'month',
      perLeadPence: 1000,
      chargeNowPence: null,
      firstBillNote: 'Pro-rated onto your next bill.',
    });
    expect(state.previewArgs).toBeNull();
  });

  it('yearly: today’s exact amount from the proration lines only', async () => {
    state.subscription = { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [PLAN_Y] } };
    state.previewLines = [
      { amount: 5836, parent: { subscription_item_details: { proration: true } } },
      { amount: 10000, parent: { subscription_item_details: { proration: false } } },
    ];
    const result = await previewRoundsTeamCharge(T, 1, db.client);
    expect(result).toMatchObject({ ok: true, interval: 'year', perLeadPence: 10000, chargeNowPence: 5836 });
    // One existing lead + one being added = quantity 2, on the yearly team price, charged now.
    expect(state.previewArgs).toMatchObject({
      customer: 'cus_1',
      subscription: 'sub_1',
      subscription_details: { items: [{ price: 'price_team_y', quantity: 2 }], proration_behavior: 'always_invoice' },
    });
  });

  it('asks about the existing team line when there is one', async () => {
    state.subscription = {
      id: 'sub_1', customer: 'cus_1', status: 'active',
      items: { data: [PLAN_Y, { id: 'si_team', price: { id: 'price_team_y' }, quantity: 1 }] },
    };
    await previewRoundsTeamCharge(T, 1, db.client);
    expect(state.previewArgs).toMatchObject({ subscription_details: { items: [{ id: 'si_team', quantity: 2 }] } });
  });

  it('never throws: a manual account, nothing to add, or a Stripe error is { ok: false }', async () => {
    expect((await previewRoundsTeamCharge(T, 0, db.client)).ok).toBe(false);
    db.rows('subscriptions')[0].source = 'manual';
    expect(await previewRoundsTeamCharge(T, 1, db.client)).toEqual({ ok: false, reason: 'not billed through Stripe' });
    db.rows('subscriptions')[0].source = 'stripe';
    state.subscription = { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [PLAN_Y] } };
    state.throwPreview = true;
    expect(await previewRoundsTeamCharge(T, 1, db.client)).toEqual({ ok: false, reason: 'preview failed' });
  });
});
