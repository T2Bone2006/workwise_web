import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sendHeldMessages = vi.fn(async () => ({ sent: 0, emailed: 0, skipped: 0, failed: 0 }));
vi.mock('@/lib/messaging/send', () => ({
  sendHeldMessages: (...args: unknown[]) => sendHeldMessages(...(args as [])),
}));

const listRoundsTenantIds = vi.fn(async () => ['t1']);
vi.mock('@/lib/messaging/rounds-tenants', () => ({
  listRoundsTenantIds: () => listRoundsTenantIds(),
}));
vi.mock('@/lib/messaging/text-allowance', () => ({ textAllowanceFor: async () => 100 }));
const pushes = vi.fn(async () => {});
vi.mock('@/lib/services/expo-push', () => ({ sendExpoPushMessages: (...a: unknown[]) => pushes(...(a as [])) }));
vi.mock('@/lib/rounds/rounds-worker', () => ({ getSoloWorkerForTenant: async () => ({ expo_push_token: 'ExponentPushToken[x]' }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake }));

type Row = Record<string, unknown> & { id: string };
let rows: Row[];
let balances: Record<string, { owed_amount: number } | null>;
let balanceError: boolean;
let credits: string[]; // what claim_text_credits returns, in order; 'none' when empty
let claimCalls: number;
let refunds: { p_from: string; p_segments: number }[];
let loseClaim: Set<string>;
let fake: ReturnType<typeof build>;

function build() {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'claim_text_credits') {
        claimCalls += 1;
        return Promise.resolve({ data: credits.shift() ?? 'none', error: null });
      }
      if (name === 'refund_text_credits') {
        refunds.push({ p_from: args.p_from as string, p_segments: args.p_segments as number });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const api: Record<string, unknown> = {
        select() {
          return api;
        },
        update(p: Record<string, unknown>) {
          patch = p;
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return Promise.resolve({
            data: rows.filter((r) => r.status === 'waiting_texts' && r.tenant_id === filters.tenant_id),
            error: null,
          });
        },
        maybeSingle() {
          if (table === 'customer_balances') {
            if (balanceError) return Promise.resolve({ data: null, error: { message: 'boom' } });
            return Promise.resolve({ data: balances[filters.customer_id as string] ?? null, error: null });
          }
          if (table === 'messages' && patch) {
            const row = rows.find((r) => r.id === filters.id && r.status === filters.status);
            if (!row || loseClaim.has(row.id)) return Promise.resolve({ data: null, error: null });
            Object.assign(row, patch);
            return Promise.resolve({ data: { id: row.id }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
}

const NOW = new Date('2026-11-18T12:00:00.000Z'); // 12:00 London, not quiet hours
const FUTURE = '2026-12-01T12:00:00.000Z';
const row = (id: string, over: Record<string, unknown> = {}): Row => ({
  id,
  tenant_id: 't1',
  customer_id: `c-${id}`,
  kind: 'visit_done',
  segments: 1,
  status: 'waiting_texts',
  waiting_since: `2026-11-1${id.length}T10:00:00.000Z`,
  waiting_expires_at: FUTURE,
  ...over,
});

async function load() {
  return import('@/lib/messaging/release-waiting');
}

describe('releaseWaitingForTenant', () => {
  beforeEach(() => {
    vi.resetModules();
    sendHeldMessages.mockClear();
    listRoundsTenantIds.mockReset();
    listRoundsTenantIds.mockResolvedValue(['t1']);
    rows = [];
    balances = {};
    balanceError = false;
    credits = [];
    claimCalls = 0;
    refunds = [];
    loseClaim = new Set();
    pushes.mockClear();
    fake = build();
  });

  it('moves a waiting money message to held once texts are available, then sends it', async () => {
    rows = [row('a')];
    credits = ['pack'];
    const { releaseWaitingForTenant } = await load();
    const result = await releaseWaitingForTenant(fake as never, 't1', NOW);
    expect(result).toMatchObject({ released: 1, stillWaiting: 0 });
    expect(rows[0]).toMatchObject({ status: 'held', billed_from: 'pack', billed_month: '2026-11' });
    expect(sendHeldMessages).toHaveBeenCalledWith(NOW, { tenantId: 't1' });
  });

  it('drops an expired message and never takes texts for it', async () => {
    rows = [row('a', { waiting_expires_at: '2026-11-18T11:00:00.000Z', kind: 'reminder' })];
    credits = ['pack'];
    const { releaseWaitingForTenant } = await load();
    const result = await releaseWaitingForTenant(fake as never, 't1', NOW);
    expect(result).toMatchObject({ expired: 1, released: 0, expiredMoney: 0 });
    expect(rows[0]).toMatchObject({ status: 'skipped', error: 'waiting_expired' });
    expect(claimCalls).toBe(0);
  });

  it('counts an expired money message separately', async () => {
    rows = [row('a', { waiting_expires_at: '2026-11-18T11:00:00.000Z' })];
    const { releaseWaitingForTenant } = await load();
    expect(await releaseWaitingForTenant(fake as never, 't1', NOW)).toMatchObject({ expired: 1, expiredMoney: 1 });
    // The owner is told once.
    expect(pushes).toHaveBeenCalledOnce();
  });

  it('a short-life message expiring does not push', async () => {
    rows = [row('a', { waiting_expires_at: '2026-11-18T11:00:00.000Z', kind: 'reminder' })];
    const { releaseWaitingForTenant } = await load();
    await releaseWaitingForTenant(fake as never, 't1', NOW);
    expect(pushes).not.toHaveBeenCalled();
  });

  it('a chaser for someone who has now paid is dropped, not sent', async () => {
    rows = [row('a', { kind: 'chaser' })];
    balances['c-a'] = { owed_amount: 0 };
    credits = ['pack'];
    const { releaseWaitingForTenant } = await load();
    const result = await releaseWaitingForTenant(fake as never, 't1', NOW);
    expect(result).toMatchObject({ stale: 1, released: 0 });
    expect(rows[0]).toMatchObject({ status: 'skipped', error: 'no_longer_needed' });
    expect(claimCalls).toBe(0);
  });

  it('a chaser whose balance cannot be checked stays waiting', async () => {
    rows = [row('a', { kind: 'chaser' })];
    balanceError = true;
    credits = ['pack'];
    const { releaseWaitingForTenant } = await load();
    const result = await releaseWaitingForTenant(fake as never, 't1', NOW);
    expect(result).toMatchObject({ stillWaiting: 1, released: 0 });
    expect(rows[0]?.status).toBe('waiting_texts');
    expect(claimCalls).toBe(0);
  });

  it('a chaser still owed goes', async () => {
    rows = [row('a', { kind: 'chaser' })];
    balances['c-a'] = { owed_amount: 40 };
    credits = ['allowance'];
    const { releaseWaitingForTenant } = await load();
    expect(await releaseWaitingForTenant(fake as never, 't1', NOW)).toMatchObject({ released: 1 });
  });

  it('runs out of texts part-way: oldest go, the rest keep waiting', async () => {
    rows = [row('a'), row('bb'), row('ccc')];
    credits = ['pack']; // only one text
    const { releaseWaitingForTenant } = await load();
    const result = await releaseWaitingForTenant(fake as never, 't1', NOW);
    expect(result).toMatchObject({ released: 1, stillWaiting: 2 });
    expect(rows.map((r) => r.status)).toEqual(['held', 'waiting_texts', 'waiting_texts']);
    expect(claimCalls).toBe(2); // stopped asking after the first "none"
  });

  it('a row someone else already claimed: the texts taken are given back', async () => {
    rows = [row('a')];
    credits = ['pack'];
    loseClaim.add('a');
    const { releaseWaitingForTenant } = await load();
    const result = await releaseWaitingForTenant(fake as never, 't1', NOW);
    expect(result.released).toBe(0);
    expect(refunds).toEqual([{ p_from: 'pack', p_segments: 1 }]);
    expect(sendHeldMessages).not.toHaveBeenCalled();
  });

  it('running it twice releases nothing the second time', async () => {
    rows = [row('a')];
    credits = ['pack', 'pack'];
    const { releaseWaitingForTenant } = await load();
    await releaseWaitingForTenant(fake as never, 't1', NOW);
    const second = await releaseWaitingForTenant(fake as never, 't1', NOW);
    expect(second).toMatchObject({ released: 0, stillWaiting: 0 });
  });

  it('at night the row is held until morning', async () => {
    rows = [row('a')];
    credits = ['pack'];
    const night = new Date('2026-11-18T22:30:00.000Z');
    const { releaseWaitingForTenant } = await load();
    await releaseWaitingForTenant(fake as never, 't1', night);
    expect(new Date(rows[0]!.hold_until as string).getTime()).toBeGreaterThan(night.getTime());
  });

  it('a business whose plan ended has its waiting messages dropped', async () => {
    rows = [row('a')];
    credits = ['pack'];
    listRoundsTenantIds.mockResolvedValue([]);
    const { releaseWaitingForTenant } = await load();
    expect(await releaseWaitingForTenant(fake as never, 't1', NOW)).toMatchObject({ stale: 1, released: 0 });
    expect(rows[0]).toMatchObject({ status: 'skipped', error: 'plan_ended' });
  });

  it('never throws, even when the tenant lookup fails', async () => {
    rows = [row('a')];
    listRoundsTenantIds.mockRejectedValue(new Error('down'));
    const { releaseWaitingForTenant } = await load();
    expect(await releaseWaitingForTenant(fake as never, 't1', NOW)).toMatchObject({ stillWaiting: 1 });
    expect(rows[0]?.status).toBe('waiting_texts');
  });
});
