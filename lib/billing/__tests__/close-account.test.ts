import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'user-1';
const MANAGED = 'This account is managed by WorkWise. Contact us to close it.';
const ALREADY = 'This account is already closed.';

type TenantRow = {
  id: string;
  name: string;
  closed_at: string | null;
  purge_after: string | null;
  stripe_customer_id: string | null;
};

type StorageEntry = { name: string; id: string | null };

const state = vi.hoisted(() => ({
  tenant: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme',
    closed_at: null as string | null,
    purge_after: null as string | null,
    stripe_customer_id: 'cus_1' as string | null,
  },
  missingTenant: false,
  staleRead: false,
  subs: [{ source: 'stripe', product: 'rounds' }] as { source: string; product: string }[],
  users: [{ id: 'user-1', email: 'owner@acme.test', tenant_id: '11111111-1111-4111-8111-111111111111' }],
  liveSubs: [{ id: 'sub_1', status: 'active' }] as { id: string; status: string }[],
  cancelError: false,
  listError: false,
  claims: 0,
  writes: [] as { table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }[],
  bans: [] as { id: string; ban_duration: string }[],
  deletedUsers: [] as string[],
  purgeError: null as string | null,
  rpc: [] as { fn: string; args: { p_tenant_id: string } }[],
  removed: [] as string[],
  storage: {} as Record<string, StorageEntry[]>,
}));

const disconnect = vi.hoisted(() => vi.fn(async (_admin: unknown, _args: { tenantId: string }) => {}));
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const sendEmail = vi.hoisted(() => vi.fn(async (_payload: unknown) => ({ data: { id: 'em_1' }, error: null })));

const { stripe, getStripe } = vi.hoisted(() => {
  const stripe = {
    subscriptions: {
      list: vi.fn(),
      cancel: vi.fn(),
    },
  };
  return { stripe, getStripe: vi.fn(() => stripe) };
});

function resetTenant(): TenantRow {
  return {
    id: TENANT,
    name: 'Acme',
    closed_at: null,
    purge_after: null,
    stripe_customer_id: 'cus_1',
  };
}

function from(table: string) {
  const filters: Record<string, unknown> = {};
  let patch: Record<string, unknown> | null = null;
  let op: 'select' | 'update' = 'select';

  async function many(): Promise<{ data: unknown; error: { message: string } | null }> {
    if (table === 'tenants' && op === 'update') {
      if (filters['is:closed_at'] === null && state.tenant.closed_at != null) {
        return { data: [], error: null };
      }
      state.tenant.closed_at = (patch?.closed_at as string | null) ?? state.tenant.closed_at;
      state.tenant.purge_after = (patch?.purge_after as string | null) ?? state.tenant.purge_after;
      state.claims += 1;
      return { data: [{ purge_after: state.tenant.purge_after }], error: null };
    }

    if (table === 'tenants') {
      if (state.missingTenant) return { data: [], error: null };
      let rows: TenantRow[] = [state.tenant];
      if (filters.id && filters.id !== state.tenant.id) rows = [];
      if (Object.prototype.hasOwnProperty.call(filters, 'not:closed_at:is')) {
        rows = rows.filter((row) => row.closed_at != null);
      }
      if (state.staleRead) rows = rows.map((row) => ({ ...row, closed_at: null }));
      return { data: rows, error: null };
    }

    if (table === 'subscriptions') return { data: state.subs, error: null };

    if (table === 'users') {
      let rows = state.users;
      if (typeof filters.id === 'string') rows = rows.filter((row) => row.id === filters.id);
      if (typeof filters.tenant_id === 'string') rows = rows.filter((row) => row.tenant_id === filters.tenant_id);
      return { data: rows, error: null };
    }

    if ((table === 'messages' || table === 'lite_texts' || table === 'widget_clients') && op === 'update') {
      state.writes.push({ table, patch: patch ?? {}, filters: { ...filters } });
      return { data: [], error: null };
    }

    return { data: [], error: null };
  }

  const api = {
    select() {
      return api;
    },
    update(value: Record<string, unknown>) {
      op = 'update';
      patch = value;
      return api;
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return api;
    },
    is(col: string, val: unknown) {
      filters[`is:${col}`] = val;
      return api;
    },
    not(col: string, operator: string, val: unknown) {
      filters[`not:${col}:${operator}`] = val;
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    maybeSingle: async () => {
      const result = await many();
      const rows = Array.isArray(result.data) ? result.data : [];
      return { data: rows[0] ?? null, error: result.error };
    },
    then(
      onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
      onRejected?: (err: unknown) => unknown,
    ) {
      return many().then(onFulfilled, onRejected);
    },
  };
  return api;
}

const admin = {
  from,
  rpc: async (fn: string, args: { p_tenant_id: string }) => {
    state.rpc.push({ fn, args });
    if (state.purgeError) return { data: null, error: { message: state.purgeError } };
    return { data: { purged: true }, error: null };
  },
  auth: {
    admin: {
      updateUserById: async (id: string, body: { ban_duration: string }) => {
        state.bans.push({ id, ban_duration: body.ban_duration });
        return { data: { user: { id } }, error: null };
      },
      deleteUser: async (id: string) => {
        state.deletedUsers.push(id);
        return { data: {}, error: null };
      },
      getUserById: async (id: string) => {
        const user = state.users.find((row) => row.id === id);
        return { data: { user: user ? { id: user.id, email: user.email } : null }, error: null };
      },
    },
  },
  storage: {
    from(bucket: string) {
      return {
        list: async (prefix: string) => ({ data: state.storage[`${bucket}/${prefix}`] ?? [], error: null }),
        remove: async (paths: string[]) => {
          for (const path of paths) state.removed.push(`${bucket}/${path}`);
          return { data: paths, error: null };
        },
      };
    },
  },
};

vi.mock('@/lib/stripe/client', () => ({ getStripe }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut } }),
}));
vi.mock('@/lib/gocardless/oauth', () => ({
  disconnectGoCardless: (adminClient: unknown, args: { tenantId: string }) => disconnect(adminClient, args),
}));
vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: (payload: unknown) => sendEmail(payload) } },
  FROM_EMAIL: 'noreply@joinworkwise.com',
}));

import { closeAccount, purgeDueAccounts } from '@/lib/billing/close-account';
import { buildAccountClosedEmail } from '@/lib/emails/account-closed';

function seedStorage() {
  state.storage = {
    [`expense-receipts/${TENANT}`]: [{ name: 'exp.pdf', id: 'e1' }],
    [`business-assets/${TENANT}`]: [{ name: 'logo.png', id: 'l1' }],
    [`setup-requests/${TENANT}`]: [{ name: 'req', id: null }],
    [`setup-requests/${TENANT}/req`]: [{ name: 'a.csv', id: 's1' }],
  };
}

describe('closeAccount', () => {
  beforeEach(() => {
    state.tenant = resetTenant();
    state.missingTenant = false;
    state.staleRead = false;
    state.subs = [{ source: 'stripe', product: 'rounds' }];
    state.users = [{ id: USER, email: 'owner@acme.test', tenant_id: TENANT }];
    state.liveSubs = [{ id: 'sub_1', status: 'active' }];
    state.cancelError = false;
    state.listError = false;
    state.claims = 0;
    state.writes = [];
    state.bans = [];
    state.deletedUsers = [];
    state.purgeError = null;
    state.rpc = [];
    state.removed = [];
    state.storage = {};
    disconnect.mockClear();
    signOut.mockClear();
    sendEmail.mockClear();
    stripe.subscriptions.list.mockReset();
    stripe.subscriptions.cancel.mockReset();
    stripe.subscriptions.list.mockImplementation(async () => {
      if (state.listError) throw Object.assign(new Error('down'), { name: 'StripeConnectionError' });
      return { data: state.liveSubs, has_more: false };
    });
    stripe.subscriptions.cancel.mockImplementation(async () => {
      if (state.cancelError) throw Object.assign(new Error('down'), { name: 'StripeAPIError' });
      return { id: 'sub_1' };
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refuses a Pro or managed business', async () => {
    state.subs = [{ source: 'stripe', product: 'pro' }];
    await expect(closeAccount(TENANT, USER)).resolves.toEqual({ ok: false, error: MANAGED });

    state.subs = [{ source: 'manual', product: 'rounds' }];
    await expect(closeAccount(TENANT, USER)).resolves.toEqual({ ok: false, error: MANAGED });

    state.subs = [{ source: 'stripe', product: 'rounds' }];
    state.tenant.stripe_customer_id = null;
    await expect(closeAccount(TENANT, USER)).resolves.toEqual({ ok: false, error: MANAGED });

    state.tenant.stripe_customer_id = 'cus_1';
    state.missingTenant = true;
    await expect(closeAccount(TENANT, USER)).resolves.toEqual({ ok: false, error: MANAGED });

    expect(state.tenant.closed_at).toBeNull();
    expect(state.claims).toBe(0);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('claims the close once; a second submit is already closed', async () => {
    const first = await closeAccount(TENANT, USER);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.purgeAfter).toBe(state.tenant.purge_after);
    expect(state.claims).toBe(1);

    await expect(closeAccount(TENANT, USER)).resolves.toEqual({ ok: false, error: ALREADY });
    expect(state.claims).toBe(1);

    state.staleRead = true;
    await expect(closeAccount(TENANT, USER)).resolves.toEqual({ ok: false, error: ALREADY });
    expect(state.claims).toBe(1);
  });

  it('still closes when Stripe fails, and the cron cancels the subscription on the next run', async () => {
    state.cancelError = true;
    const result = await closeAccount(TENANT, USER);
    expect(result.ok).toBe(true);
    expect(state.tenant.closed_at).not.toBeNull();
    expect(state.bans).toEqual([{ id: USER, ban_duration: '876000h' }]);
    expect(state.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'messages',
          patch: { status: 'skipped', error: 'plan_ended' },
          filters: expect.objectContaining({ status: 'held', tenant_id: TENANT }),
        }),
        expect.objectContaining({
          table: 'lite_texts',
          patch: { status: 'skipped', skip_reason: 'plan_ended' },
          filters: expect.objectContaining({ status: 'scheduled', tenant_id: TENANT }),
        }),
      ]),
    );

    stripe.subscriptions.cancel.mockClear();
    state.cancelError = false;
    const counts = await purgeDueAccounts(new Date());
    expect(counts).toEqual({ purged: 0, failed: 0, skipped: 1 });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
      'sub_1',
      { prorate: false, invoice_now: false },
      { idempotencyKey: `close-${TENANT}-sub_1` },
    );
    expect(state.rpc).toEqual([]);
  });

  it('skips held texts and scheduled lead texts, and bans every login', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await closeAccount(TENANT, USER);
    expect(result.ok).toBe(true);
    expect(state.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'messages',
          patch: { status: 'skipped', error: 'plan_ended' },
        }),
        expect.objectContaining({
          table: 'lite_texts',
          patch: { status: 'skipped', skip_reason: 'plan_ended' },
        }),
        expect.objectContaining({ table: 'widget_clients', patch: { active: false } }),
      ]),
    );
    expect(state.bans).toEqual([{ id: USER, ban_duration: '876000h' }]);
    expect(disconnect).toHaveBeenCalledWith(admin, { tenantId: TENANT });
    expect(signOut).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@acme.test',
        subject: 'Your WorkWise account is closed',
        text: expect.stringContaining("We've closed Acme's WorkWise account."),
      }),
    );

    const logged = [...info.mock.calls, ...errorLog.mock.calls].flat().map((part) => String(part)).join(' ');
    expect(logged).not.toContain('owner@acme.test');
    expect(logged).not.toContain('Acme');
  });

  it('skips businesses that are closed but not due yet', async () => {
    state.tenant.closed_at = '2026-01-01T00:00:00.000Z';
    state.tenant.purge_after = '2026-06-01T00:00:00.000Z';
    const counts = await purgeDueAccounts(new Date('2026-02-01T00:00:00.000Z'));
    expect(counts).toEqual({ purged: 0, failed: 0, skipped: 1 });
    expect(state.rpc).toEqual([]);
    expect(state.removed).toEqual([]);
    expect(state.deletedUsers).toEqual([]);
  });

  it('counts a purge_tenant error as failed and leaves the logins in place', async () => {
    state.tenant.closed_at = '2026-01-01T00:00:00.000Z';
    state.tenant.purge_after = '2026-01-15T00:00:00.000Z';
    state.purgeError = 'purge_tenant: 11111111-1111-4111-8111-111111111111 stuck on public.jobs';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const counts = await purgeDueAccounts(new Date('2026-02-01T00:00:00.000Z'));
    expect(counts).toEqual({ purged: 0, failed: 1, skipped: 0 });
    expect(state.deletedUsers).toEqual([]);
    expect(errorLog).toHaveBeenCalledWith(
      '[close-account] purge_tenant',
      TENANT,
      state.purgeError,
    );
  });

  it('purges a due business: files, then the database, then the logins', async () => {
    state.tenant.closed_at = '2026-01-01T00:00:00.000Z';
    state.tenant.purge_after = '2026-01-15T00:00:00.000Z';
    seedStorage();

    const counts = await purgeDueAccounts(new Date('2026-02-01T00:00:00.000Z'));
    expect(counts).toEqual({ purged: 1, failed: 0, skipped: 0 });
    expect(state.removed).toEqual([
      `expense-receipts/${TENANT}/exp.pdf`,
      `business-assets/${TENANT}/logo.png`,
      `setup-requests/${TENANT}/req/a.csv`,
    ]);
    expect(state.rpc).toEqual([{ fn: 'purge_tenant', args: { p_tenant_id: TENANT } }]);
    expect(state.deletedUsers).toEqual([USER]);
    expect(state.removed.length).toBeGreaterThan(0);
    expect(state.rpc.length).toBe(1);
  });
});

describe('buildAccountClosedEmail', () => {
  it('uses the closed-account subject and escapes the business name', () => {
    const built = buildAccountClosedEmail({ businessName: 'A&B <Ltd>', purgeDate: '5 November 2026' });
    expect(built.subject).toBe('Your WorkWise account is closed');
    expect(built.text).toContain(
      "We've closed A&B <Ltd>'s WorkWise account. Billing has stopped and nobody can sign in any more.",
    );
    expect(built.text).toContain('permanently deleted on 5 November 2026');
    expect(built.text).toContain("reply to this email before then and we'll restore it.");
    expect(built.html).toContain('A&amp;B &lt;Ltd&gt;');
    expect(built.html).not.toContain('A&B <Ltd>');
  });
});
