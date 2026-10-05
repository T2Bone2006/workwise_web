import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.hoisted(() => vi.fn());
const userQuery = vi.hoisted(() => vi.fn());
const getTenantProducts = vi.hoisted(() => vi.fn());
const widgetQuery = vi.hoisted(() => vi.fn());
const adminFrom = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (table: string) => {
      if (table !== 'users') throw new Error(table);
      return {
        select: () => ({
          eq: (_key: string, value: unknown) => {
            userQuery(value);
            return { maybeSingle: async () => session.userRow };
          },
        }),
      };
    },
  }),
}));

vi.mock('@/lib/data/tenant-products', () => ({
  getTenantProducts: () => getTenantProducts(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => adminFrom(table),
  }),
}));

import { requireLite } from '@/lib/lite/require-lite';

const session = {
  user: { id: 'user-1' } as { id: string } | null,
  userRow: { data: { role: 'admin', tenant_id: 'tenant-1' } as { role: string; tenant_id: string } | null, error: null as { message: string } | null },
};

const widget = {
  id: 'widget-1',
  business_name: "Dave's Plastering",
  sign_off_name: 'Dave',
  trade: 'plastering',
  service_area: 'South Manchester',
  business_context: 'Family firm',
  allowed_domains: [] as string[],
  website_url: null as string | null,
};

function reset() {
  session.user = { id: 'user-1' };
  session.userRow = { data: { role: 'admin', tenant_id: 'tenant-1' }, error: null };
  getUser.mockReset();
  getUser.mockImplementation(async () => ({ data: { user: session.user } }));
  userQuery.mockReset();
  getTenantProducts.mockReset();
  getTenantProducts.mockResolvedValue({ hasLite: true, hasRounds: false, isPro: false });
  widgetQuery.mockReset();
  adminFrom.mockReset();
  adminFrom.mockImplementation((table: string) => {
    if (table !== 'widget_clients') throw new Error(table);
    return {
      select: () => ({
        eq: (key: string, value: unknown) => {
          widgetQuery(key, value);
          return { maybeSingle: async () => ({ data: widget, error: null }) };
        },
      }),
    };
  });
}

describe('requireLite', () => {
  beforeEach(reset);

  it('lets a Lite admin practise before a website is set', async () => {
    const result = await requireLite();
    expect(result).toEqual({
      ok: true,
      ctx: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        widget: {
          id: 'widget-1',
          business_name: "Dave's Plastering",
          sign_off_name: 'Dave',
          trade: 'plastering',
          service_area: 'South Manchester',
          business_context: 'Family firm',
        },
      },
    });
    expect(widgetQuery).toHaveBeenCalledWith('tenant_id', 'tenant-1');
    expect(adminFrom).toHaveBeenCalledTimes(1);
  });

  it('refuses a logged-out caller with 401', async () => {
    session.user = null;
    const result = await requireLite();
    expect(result).toEqual({ ok: false, status: 401, error: 'Not signed in' });
    expect(getTenantProducts).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it('refuses a worker, a Pro-only login, and a business without Lite with 403', async () => {
    session.userRow = { data: { role: 'worker', tenant_id: 'tenant-1' }, error: null };
    const worker = await requireLite();
    expect(worker).toMatchObject({ ok: false, status: 403 });
    expect(getTenantProducts).not.toHaveBeenCalled();

    session.userRow = { data: { role: 'admin', tenant_id: 'tenant-1' }, error: null };
    getTenantProducts.mockResolvedValue({ hasLite: false, hasRounds: false, isPro: true });
    const pro = await requireLite();
    expect(pro).toEqual({ ok: false, status: 403, error: 'The website assistant is part of Lite.' });
    expect(adminFrom).not.toHaveBeenCalled();

    getTenantProducts.mockResolvedValue({ hasLite: false, hasRounds: true, isPro: false });
    const rounds = await requireLite();
    expect(rounds).toMatchObject({ ok: false, status: 403 });
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("answers 404 'No widget' when this business has no widget row", async () => {
    adminFrom.mockImplementation((table: string) => {
      if (table !== 'widget_clients') throw new Error(table);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
    });
    const missing = await requireLite();
    expect(missing).toEqual({ ok: false, status: 404, error: 'No widget' });

    adminFrom.mockImplementation(() => {
      throw new Error('db down');
    });
    const broken = await requireLite();
    expect(broken).toEqual({ ok: false, status: 404, error: 'No widget' });
  });
});
