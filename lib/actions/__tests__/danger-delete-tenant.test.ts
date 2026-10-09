import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  name: 'Acme' as string,
  customerId: 'cus_1' as string | null,
  subs: [] as { source: string | null; product: string | null }[],
  deleted: 0,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/billing/close-account', () => ({ closeAccount: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'owner@acme.test' } } }),
      signInWithPassword: async () => ({ error: null }),
    },
    from(table: string) {
      const api = {
        select: () => api,
        eq: () => api,
        delete() {
          return {
            eq: async () => {
              state.deleted += 1;
              return { error: null };
            },
          };
        },
        single: async () => ({ data: table === 'tenants' ? { name: state.name } : null, error: null }),
        maybeSingle: async () => {
          if (table === 'users') return { data: { tenant_id: TENANT }, error: null };
          if (table === 'tenants') return { data: { stripe_customer_id: state.customerId }, error: null };
          return { data: null, error: null };
        },
        then(ok: (v: { data: unknown; error: unknown }) => unknown, bad?: (e: unknown) => unknown) {
          return Promise.resolve({ data: table === 'subscriptions' ? state.subs : [], error: null }).then(ok, bad);
        },
      };
      return api;
    },
  }),
}));

import { dangerDeleteTenant } from '@/lib/actions/settings';

const USE_CLOSE = 'Use Close my account instead.';

describe('dangerDeleteTenant', () => {
  beforeEach(() => {
    state.name = 'Acme';
    state.customerId = 'cus_1';
    state.subs = [];
    state.deleted = 0;
  });

  it.each(['starter', 'growth', 'pro', 'rounds', 'lite'])(
    'sends a Stripe-billed %s business to Close my account',
    async (product) => {
      state.subs = [{ source: 'stripe', product }];
      await expect(dangerDeleteTenant('Acme', 'pw')).resolves.toEqual({ success: false, error: USE_CLOSE });
      expect(state.deleted).toBe(0);
    },
  );

  it('still deletes a hand-set-up Pro business, as before', async () => {
    state.subs = [{ source: 'manual', product: 'pro' }];
    await expect(dangerDeleteTenant('Acme', 'pw')).resolves.toEqual({ success: true });
    expect(state.deleted).toBe(1);
  });

  it('still deletes a Pro row that is not Stripe-billed, and a business with no Stripe customer', async () => {
    state.subs = [{ source: 'stripe', product: 'starter' }, { source: 'other', product: 'pro' }];
    await expect(dangerDeleteTenant('Acme', 'pw')).resolves.toEqual({ success: true });
    state.customerId = null;
    state.subs = [{ source: 'stripe', product: 'starter' }];
    await expect(dangerDeleteTenant('Acme', 'pw')).resolves.toEqual({ success: true });
  });

  it('refuses when the business name does not match', async () => {
    await expect(dangerDeleteTenant('Other', 'pw')).resolves.toEqual({ success: false, error: 'Company name does not match' });
    expect(state.deleted).toBe(0);
  });
});
