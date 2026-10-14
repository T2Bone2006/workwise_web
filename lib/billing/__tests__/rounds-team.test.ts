import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }));

type Item = { id: string; price: { id: string }; quantity?: number };
const stripeState = {
  subscription: null as null | { id: string; status: string; items: { data: Item[] }; customer: string },
  calls: [] as Array<{ fn: string; args: unknown[] }>,
  throwOn: null as null | string,
};
const stripe = {
  subscriptions: {
    retrieve: async () => {
      if (stripeState.throwOn === 'retrieve') throw new Error('stripe down');
      return stripeState.subscription;
    },
  },
  subscriptionItems: {
    create: async (...args: unknown[]) => void stripeState.calls.push({ fn: 'create', args }),
    update: async (...args: unknown[]) => void stripeState.calls.push({ fn: 'update', args }),
    del: async (...args: unknown[]) => void stripeState.calls.push({ fn: 'del', args }),
  },
};
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => stripe }));

let db: import('./../../team/__tests__/fake-db').FakeDb;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));

import { fakeDb } from '../../team/__tests__/fake-db';
import { countLeads, reconcileAllRoundsTeams, reconcileRoundsTeam, reconcileRoundsTeamAfterChange } from '@/lib/billing/rounds-team';

const T = 'tenant-1';

function seed(opts: { leads?: number; source?: string; subId?: string | null } = {}) {
  const leads = opts.leads ?? 1;
  const people = Array.from({ length: leads }, (_, i) => ({
    id: `p${i}`, tenant_id: T, kind: 'lead', worker_id: `w${i}`, ended_at: null,
  }));
  const workers = Array.from({ length: leads }, (_, i) => ({ id: `w${i}`, invite_status: 'pending' }));
  db = fakeDb({
    team_people: [...people, { id: 'h1', tenant_id: T, kind: 'helper', worker_id: null, ended_at: null }],
    workers,
    subscriptions: [
      { tenant_id: T, product: 'rounds', status: 'active', source: opts.source ?? 'stripe', stripe_subscription_id: opts.subId === undefined ? 'sub_1' : opts.subId },
    ],
  });
}

function sub(items: Item[], status = 'active') {
  stripeState.subscription = { id: 'sub_1', status, items: { data: items }, customer: 'cus_1' };
}

const PLAN_M = { id: 'si_plan', price: { id: 'price_rounds_m' }, quantity: 1 };
const PLAN_Y = { id: 'si_plan', price: { id: 'price_rounds_y' }, quantity: 1 };
const TEAM_M = (q: number): Item => ({ id: 'si_team', price: { id: 'price_team_m' }, quantity: q });

beforeEach(() => {
  process.env.STRIPE_PRICE_ROUNDS = 'price_rounds_m';
  process.env.STRIPE_PRICE_ROUNDS_YEARLY = 'price_rounds_y';
  process.env.STRIPE_PRICE_ROUNDS_TEAM_MONTHLY = 'price_team_m';
  process.env.STRIPE_PRICE_ROUNDS_TEAM_YEARLY = 'price_team_y';
  stripeState.calls = [];
  stripeState.throwOn = null;
  seed();
  sub([PLAN_M]);
});

describe('countLeads', () => {
  it('counts leads including pending invites, never helpers, deactivated or ended people', async () => {
    seed({ leads: 3 });
    db.rows('workers').find((w) => w.id === 'w2')!.invite_status = 'deactivated';
    db.rows('team_people').find((p) => p.id === 'p1')!.ended_at = '2026-01-01';
    expect(await countLeads(T, db.client)).toBe(1);
  });

  it('is zero with no leads', async () => {
    seed({ leads: 0 });
    expect(await countLeads(T, db.client)).toBe(0);
  });
});

describe('reconcileRoundsTeam', () => {
  it('adds the team line for the first lead (monthly: prorated onto the next bill)', async () => {
    const result = await reconcileRoundsTeam(T, db.client);
    expect(result).toEqual({ outcome: 'added', leads: 1 });
    expect(stripeState.calls).toEqual([
      { fn: 'create', args: [{ subscription: 'sub_1', price: 'price_team_m', quantity: 1, proration_behavior: 'create_prorations' }] },
    ]);
  });

  it('charges the part-year at once on a yearly plan and uses the yearly price', async () => {
    sub([PLAN_Y]);
    await reconcileRoundsTeam(T, db.client);
    expect(stripeState.calls[0].args[0]).toMatchObject({ price: 'price_team_y', proration_behavior: 'always_invoice' });
  });

  it('updates the quantity for a second lead and removes the line with no leads', async () => {
    seed({ leads: 2 });
    sub([PLAN_M, TEAM_M(1)]);
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'updated', leads: 2 });
    expect(stripeState.calls[0]).toEqual({
      fn: 'update',
      args: ['si_team', { price: 'price_team_m', quantity: 2, proration_behavior: 'create_prorations' }],
    });

    stripeState.calls = [];
    seed({ leads: 0 });
    sub([PLAN_M, TEAM_M(2)]);
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'removed', leads: 0 });
    expect(stripeState.calls[0]).toEqual({ fn: 'del', args: ['si_team', { proration_behavior: 'create_prorations' }] });
  });

  it('is unchanged when the line already matches, and running twice does nothing more', async () => {
    sub([PLAN_M, TEAM_M(1)]);
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'unchanged', leads: 1 });
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'unchanged', leads: 1 });
    expect(stripeState.calls).toEqual([]);
  });

  it('finds the plan line by price, whatever the order', async () => {
    sub([TEAM_M(1), PLAN_M]);
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'unchanged', leads: 1 });
  });

  it('moves a monthly team line to the yearly price when the plan is yearly', async () => {
    sub([PLAN_Y, TEAM_M(1)]);
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'updated', leads: 1 });
    expect(stripeState.calls[0].args[1]).toMatchObject({ price: 'price_team_y', proration_behavior: 'always_invoice' });
  });

  it('never touches a manual account, a business with no Stripe subscription, or no subscription', async () => {
    seed({ source: 'manual', subId: null });
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'skipped', reason: 'manual account' });
    seed({ subId: null });
    expect((await reconcileRoundsTeam(T, db.client)).outcome).toBe('skipped');
    db = fakeDb({});
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'skipped', reason: 'no Rounds subscription' });
    expect(stripeState.calls).toEqual([]);
  });

  it('skips a subscription that is not billable', async () => {
    sub([PLAN_M], 'canceled');
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'skipped', reason: 'subscription is canceled' });
    sub([PLAN_M], 'incomplete');
    expect((await reconcileRoundsTeam(T, db.client)).outcome).toBe('skipped');
  });

  it('changes nothing when the team prices are not configured', async () => {
    delete process.env.STRIPE_PRICE_ROUNDS_TEAM_MONTHLY;
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'skipped', reason: 'team prices not configured' });
    expect(stripeState.calls).toEqual([]);
  });

  it('skips when the plan line is not recognised', async () => {
    sub([{ id: 'si_x', price: { id: 'price_unknown' }, quantity: 1 }]);
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'skipped', reason: 'plan line not recognised' });
  });

  it('turns a Stripe failure into an error result and never throws', async () => {
    stripeState.throwOn = 'retrieve';
    expect(await reconcileRoundsTeam(T, db.client)).toEqual({ outcome: 'error', message: 'stripe down' });
  });

  it('reconcileRoundsTeamAfterChange(null) does nothing and never throws', () => {
    expect(() => reconcileRoundsTeamAfterChange(null)).not.toThrow();
    expect(() => reconcileRoundsTeamAfterChange(undefined)).not.toThrow();
    expect(stripeState.calls).toEqual([]);
  });
});

describe('reconcileAllRoundsTeams', () => {
  it('visits each Stripe-billed Rounds business once and tallies', async () => {
    db.rows('subscriptions').push(
      { tenant_id: 'tenant-2', product: 'rounds', status: 'active', source: 'stripe', stripe_subscription_id: 'sub_2' },
      { tenant_id: 'tenant-3', product: 'rounds', status: 'active', source: 'manual', stripe_subscription_id: null },
      { tenant_id: 'tenant-4', product: 'pro', status: 'active', source: 'stripe', stripe_subscription_id: 'sub_4' },
    );
    const tally = await reconcileAllRoundsTeams();
    // tenant-1 has a lead and no team line yet (added); tenant-2 has no leads (unchanged); the manual and Pro rows are not visited.
    expect(tally).toEqual({ checked: 2, changed: 1, skipped: 0, errors: 0 });
  });
});
