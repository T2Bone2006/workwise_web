import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tenantId: 'ten-1' as string | null,
  user: { id: 'user-1' } as { id: string } | null,
  role: 'admin' as string | null,
  closedAt: null as string | null,
  subs: [] as { source: string | null; product: string | null; status: string | null }[],
  code: 'ABCD2345' as string | null,
  readError: false,
}));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@/lib/data/tenant', () => ({ getTenantIdForCurrentUser: async () => state.tenantId }));
vi.mock('@/lib/supabase/auth-user', () => ({
  getAuthUser: async () => ({ user: state.user, error: null }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: { referral_code: state.code }, error: null }),
      };
      return api;
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => {
          if (state.readError) return { data: null, error: { message: 'down' } };
          if (table === 'users') return { data: { role: state.role }, error: null };
          if (table === 'tenants') return { data: { closed_at: state.closedAt }, error: null };
          return { data: null, error: null };
        },
        then(ok: (v: { data: unknown; error: unknown }) => unknown, bad?: (e: unknown) => unknown) {
          const result = state.readError
            ? { data: null, error: { message: 'down' } }
            : { data: table === 'subscriptions' ? state.subs : [], error: null };
          return Promise.resolve(result).then(ok, bad);
        },
      };
      return api;
    },
  }),
}));

import { kindFromRows, referralKind, shouldShowReferral } from '@/lib/data/referral-nudge';

const stripe = (product: string, status = 'active') => ({ source: 'stripe', product, status });

describe('referralKind', () => {
  beforeEach(() => {
    state.tenantId = 'ten-1';
    state.user = { id: 'user-1' };
    state.role = 'admin';
    state.closedAt = null;
    state.subs = [];
    state.code = 'ABCD2345';
    state.readError = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('is rounds_lite for a live Rounds or Lite business', async () => {
    state.subs = [stripe('rounds')];
    expect(await referralKind()).toBe('rounds_lite');
    state.subs = [stripe('lite', 'trialing')];
    expect(await referralKind()).toBe('rounds_lite');
  });

  it.each(['starter', 'growth', 'pro'])('is pro for a Stripe-billed %s admin', async (tier) => {
    state.subs = [stripe(tier)];
    expect(await referralKind()).toBe('pro');
  });

  it('is null for manual Pro, a non-admin, a closed business, no code, an ended plan or a read error', async () => {
    state.subs = [{ source: 'manual', product: 'pro', status: 'manual' }];
    expect(await referralKind()).toBeNull();

    state.subs = [stripe('starter')];
    state.role = 'worker';
    expect(await referralKind()).toBeNull();
    state.role = 'admin';

    state.closedAt = '2026-10-01T00:00:00Z';
    expect(await referralKind()).toBeNull();
    state.closedAt = null;

    state.code = null;
    expect(await referralKind()).toBeNull();
    state.code = 'ABCD2345';

    state.subs = [stripe('starter', 'canceled')];
    expect(await referralKind()).toBeNull();

    state.subs = [stripe('starter')];
    state.readError = true;
    expect(await referralKind()).toBeNull();
  });
});

describe('shouldShowReferral', () => {
  beforeEach(() => {
    state.role = 'admin';
    state.closedAt = null;
    state.code = 'ABCD2345';
    state.readError = false;
  });

  it('is unchanged for Rounds/Lite and false for Pro', async () => {
    state.subs = [stripe('rounds')];
    expect(await shouldShowReferral()).toBe(true);
    state.subs = [stripe('starter')];
    expect(await shouldShowReferral()).toBe(false);
  });
});

describe('kindFromRows', () => {
  it('a manual row anywhere, or a Pro row that is not Stripe-billed, is null', () => {
    expect(kindFromRows([stripe('rounds'), { source: 'manual', product: 'rounds', status: 'manual' }])).toBeNull();
    expect(kindFromRows([stripe('starter'), { source: 'other', product: 'pro', status: 'active' }])).toBeNull();
  });
});
