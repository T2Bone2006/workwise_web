import { beforeEach, describe, expect, it, vi } from 'vitest';

type Rows = Record<string, unknown>;

/** A query stand-in: every filter returns itself; awaiting or maybeSingle() answers with the table's data. */
function table(data: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null });
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
  return q;
}

let user: Rows | null;
let userRow: Rows | null;
let subscriptions: Rows[];
let tenantSettings: Rows | null;

vi.mock('@/lib/auth/bearer', () => ({ createClientFromBearer: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => table(userRow),
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (name: string) => table(name === 'subscriptions' ? subscriptions : { settings: tenantSettings }),
  }),
}));

const { requireAssistantCaller } = await import('@/lib/assistant/caller');
const request = new Request('http://localhost/api/assistant/chat', { method: 'POST' });

beforeEach(() => {
  user = { id: 'u1' };
  userRow = { role: 'admin', tenant_id: 't1' };
  subscriptions = [{ product: 'rounds' }];
  tenantSettings = null;
});

describe('who may ask Lily', () => {
  it('lets a Rounds business in, as before', async () => {
    const r = await requireAssistantCaller(request);
    expect(r.ok && r.ctx).toMatchObject({ hasRounds: true, hasLite: false, hasPro: false, tenantId: 't1' });
  });

  it('lets a Pro office in whatever an old look setting says (there is no look switch any more)', async () => {
    subscriptions = [{ product: 'pro' }];
    tenantSettings = {};
    const r = await requireAssistantCaller(request);
    expect(r.ok && r.ctx).toMatchObject({ hasPro: true, hasRounds: false, hasLite: false });
  });

  it('still refuses a worker, and someone signed out', async () => {
    subscriptions = [{ product: 'pro' }];
    tenantSettings = { look: 'new' };
    userRow = { role: 'worker', tenant_id: 't1' };
    const worker = await requireAssistantCaller(request);
    expect(!worker.ok && worker.response.status).toBe(403);
    user = null;
    const signedOut = await requireAssistantCaller(request);
    expect(!signedOut.ok && signedOut.response.status).toBe(401);
  });

  it('says the plan has ended when there is no product at all', async () => {
    subscriptions = [];
    const r = await requireAssistantCaller(request);
    expect(!r.ok && r.response.status).toBe(403);
  });
});
