import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const createClientFromBearer = vi.fn();
vi.mock('@/lib/auth/bearer', () => ({ createClientFromBearer: (r: Request) => createClientFromBearer(r) }));

let db: import('../../team/__tests__/fake-db').FakeDb;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));

import { requireStaffApi } from '@/lib/api/staff-request';
import { fakeDb } from '../../team/__tests__/fake-db';

const T = 't1';
const req = () => new Request('http://localhost/api/staff/day', { headers: { Authorization: 'Bearer x' } });

function seed(over: { worker?: Record<string, unknown>; person?: Record<string, unknown> | null; subs?: Array<Record<string, unknown>> } = {}) {
  db = fakeDb({
    workers: [{ id: 'w-dave', user_id: 'u-dave', primary_tenant_id: T, worker_type: 'employee', invite_status: 'accepted', ...over.worker }],
    team_people:
      over.person === null
        ? []
        : [{ id: 'p-dave', tenant_id: T, kind: 'lead', worker_id: 'w-dave', name: 'Dave', ended_at: null, ...over.person }],
    subscriptions: over.subs ?? [{ tenant_id: T, product: 'rounds', status: 'active' }],
  });
}

async function run() {
  const result = await requireStaffApi(req());
  if (result.ok) return { ok: true as const, ctx: result.ctx };
  return { ok: false as const, status: result.response.status, body: await result.response.json() };
}

beforeEach(() => {
  createClientFromBearer.mockReset();
  createClientFromBearer.mockResolvedValue({ supabase: {}, userId: 'u-dave' });
  seed();
});

describe('requireStaffApi', () => {
  it('lets a live lead of a Rounds business through, with everything taken from the token', async () => {
    const r = await run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx).toMatchObject({ userId: 'u-dave', tenantId: T, workerId: 'w-dave', personId: 'p-dave', name: 'Dave' });
  });

  it('401 without a valid token', async () => {
    createClientFromBearer.mockResolvedValue(null);
    expect(await run()).toMatchObject({ ok: false, status: 401, body: { error: 'Unauthorised' } });
  });

  it('403 not_staff for the owner (their own platform_solo worker row)', async () => {
    seed({ worker: { worker_type: 'platform_solo' } });
    expect(await run()).toMatchObject({ ok: false, status: 403, body: { error: 'not_staff' } });
  });

  it('403 not_staff for a login with no worker row at all', async () => {
    createClientFromBearer.mockResolvedValue({ supabase: {}, userId: 'someone-else' });
    expect(await run()).toMatchObject({ ok: false, status: 403, body: { error: 'not_staff' } });
  });

  it('403 not_staff for a deactivated lead and for an ended team person', async () => {
    seed({ worker: { invite_status: 'deactivated' } });
    expect(await run()).toMatchObject({ ok: false, status: 403, body: { error: 'not_staff' } });
    seed({ person: { ended_at: '2026-10-01T00:00:00Z' } });
    expect(await run()).toMatchObject({ ok: false, status: 403, body: { error: 'not_staff' } });
  });

  it('403 not_staff for a Pro worker (a worker with no team person) and for a Pro business', async () => {
    seed({ person: null });
    expect(await run()).toMatchObject({ ok: false, status: 403, body: { error: 'not_staff' } });
    seed({ subs: [{ tenant_id: T, product: 'rounds', status: 'active' }, { tenant_id: T, product: 'growth', status: 'active' }] });
    expect(await run()).toMatchObject({ ok: false, status: 403, body: { error: 'not_staff' } });
  });

  it('403 plan_ended when the business no longer has Rounds', async () => {
    seed({ subs: [{ tenant_id: T, product: 'rounds', status: 'canceled' }] });
    expect(await run()).toMatchObject({ ok: false, status: 403, body: { error: 'plan_ended' } });
  });

  it('refuses when a read fails (fail safe)', async () => {
    const original = db.from.bind(db);
    db.from = ((table: string) => {
      if (table === 'team_people') throw new Error('db down');
      return original(table);
    }) as never;
    expect(await run()).toMatchObject({ ok: false, status: 403, body: { error: 'not_staff' } });
  });

  it('answers with no-store caching', async () => {
    createClientFromBearer.mockResolvedValue(null);
    const result = await requireStaffApi(req());
    if (!result.ok) expect(result.response.headers.get('Cache-Control')).toBe('no-store');
  });
});
