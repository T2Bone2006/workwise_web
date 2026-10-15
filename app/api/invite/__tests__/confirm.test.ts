import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = { table: string; method: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

/** A stand-in for the Supabase admin client: records every call, answers from a per-table script. */
function makeAdmin(script: {
  invite: Record<string, unknown> | null;
  worker?: Record<string, unknown> | null;
  rpc?: { error: { code?: string; message: string } | null };
  updateUserError?: unknown;
}) {
  const ops: Op[] = [];
  const answer = (table: string, method: string): Result => {
    if (table === 'worker_invites' && method === 'maybeSingle') return { data: script.invite, error: null };
    if (table === 'workers' && method === 'maybeSingle') return { data: script.worker ?? { user_id: 'user-1' }, error: null };
    // updates / upserts: report one row changed
    return { data: [{ id: 'x' }], error: null };
  };
  const chain = (table: string) => {
    let last = '';
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (resolve: (r: Result) => void) => resolve(answer(table, last));
          }
          return (...args: unknown[]) => {
            last = prop;
            ops.push({ table, method: prop, args });
            if (prop === 'maybeSingle') return Promise.resolve(answer(table, 'maybeSingle'));
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const client = {
    from: (table: string) => chain(table),
    rpc: (name: string, args: unknown) => {
      ops.push({ table: 'rpc', method: name, args: [args] });
      return Promise.resolve({ data: 'tenant-1', error: script.rpc?.error ?? null });
    },
    auth: {
      admin: {
        updateUserById: (id: string, attrs: unknown) => {
          ops.push({ table: 'auth', method: 'updateUserById', args: [id, attrs] });
          return Promise.resolve({ error: script.updateUserError ?? null });
        },
      },
    },
  };
  return { client, ops };
}

let current: ReturnType<typeof makeAdmin>;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => current.client }));

import { POST } from '@/app/api/invite/confirm/route';

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/invite/confirm', { method: 'POST', body: JSON.stringify(body) }));

const invite = (kind?: string) => ({
  token: 't',
  worker_id: 'w1',
  tenant_id: 'employer',
  email: 'sam@example.com',
  ...(kind ? { kind } : {}),
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/invite/confirm', () => {
  it('rejects a missing token or password', async () => {
    current = makeAdmin({ invite: invite() });
    expect((await post({ token: '', password: 'x' })).status).toBe(400);
    expect((await post({ token: 't' })).status).toBe(400);
  });

  it('rejects an unknown or used invite without touching the password', async () => {
    current = makeAdmin({ invite: null });
    const res = await post({ token: 't', password: 'longenough1' });
    expect(res.status).toBe(400);
    expect(current.ops.some((o) => o.method === 'updateUserById')).toBe(false);
  });

  it('keeps the employee path as it was: password, accepted, a worker login in the employer, invite used', async () => {
    current = makeAdmin({ invite: invite('employee') });
    const res = await post({ token: 't', password: 'longenough1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'sam@example.com', password: 'longenough1', kind: 'employee' });
    const upsert = current.ops.find((o) => o.table === 'users' && o.method === 'upsert');
    expect(upsert?.args[0]).toMatchObject({ role: 'worker', tenant_id: 'employer', id: 'user-1' });
    expect(current.ops.some((o) => o.method === 'accept_business_worker_invite')).toBe(false);
    expect(current.ops.some((o) => o.table === 'worker_invites' && o.method === 'update')).toBe(true);
  });

  it('treats an invite row with no kind (before the column exists) as an employee invite', async () => {
    current = makeAdmin({ invite: invite() });
    const res = await post({ token: 't', password: 'longenough1' });
    expect((await res.json()).kind).toBe('employee');
  });

  it('refuses a set-up invite without a business name, before setting the password', async () => {
    current = makeAdmin({ invite: invite('business') });
    const res = await post({ token: 't', password: 'longenough1', business: { businessName: ' ' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/business name/i);
    expect(current.ops.some((o) => o.method === 'updateUserById')).toBe(false);
    expect(current.ops.some((o) => o.method === 'accept_business_worker_invite')).toBe(false);
  });

  it('creates the business through the database function and does not make a worker login in the employer', async () => {
    current = makeAdmin({ invite: invite('business') });
    const res = await post({
      token: 't',
      password: 'longenough1',
      business: { businessName: ' Sam Subbie Locks ', trade: 'Locksmith', postcode: 'AB1 2CD' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe('business');
    const rpc = current.ops.find((o) => o.method === 'accept_business_worker_invite');
    expect(rpc?.args[0]).toEqual({
      p_token: 't',
      p_business_name: 'Sam Subbie Locks',
      p_trade: 'Locksmith',
      p_postcode: 'AB1 2CD',
    });
    expect(current.ops.some((o) => o.table === 'users' && o.method === 'upsert')).toBe(false);
  });

  it('turns a database "invite_invalid" into the normal expired message, and anything else into a retryable 500', async () => {
    current = makeAdmin({ invite: invite('business'), rpc: { error: { message: 'invite_invalid' } } });
    const invalid = await post({ token: 't', password: 'longenough1', business: { businessName: 'Sam Locks' } });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatch(/already been used or has expired/);

    current = makeAdmin({ invite: invite('business'), rpc: { error: { code: '57014', message: 'timeout' } } });
    const broken = await post({ token: 't', password: 'longenough1', business: { businessName: 'Sam Locks' } });
    expect(broken.status).toBe(500);
    expect((await broken.json()).error).toBe('Failed to set up your account');
  });
});
