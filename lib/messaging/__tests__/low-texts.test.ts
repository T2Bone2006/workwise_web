import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sendExpoPushMessages = vi.fn(async () => {});
vi.mock('@/lib/services/expo-push', () => ({
  sendExpoPushMessages: (...a: unknown[]) => sendExpoPushMessages(...(a as [])),
}));
const getSoloWorkerForTenant = vi.fn(async () => ({ expo_push_token: 'ExponentPushToken[x]' }));
vi.mock('@/lib/rounds/rounds-worker', () => ({
  getSoloWorkerForTenant: (...a: unknown[]) => getSoloWorkerForTenant(...(a as [])),
}));
const ownerEmailFor = vi.fn(async () => 'owner@example.com');
const sendOwnerEmail = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/emails/owner-notice', () => ({
  ownerEmailFor: (...a: unknown[]) => ownerEmailFor(...(a as [])),
  sendOwnerEmail: (...a: unknown[]) => sendOwnerEmail(...(a as [])),
}));
vi.mock('@/lib/messaging/text-allowance', () => ({ textAllowanceFor: async () => 100 }));
vi.mock('@/lib/messaging/rounds-tenants', () => ({ listRoundsTenantIds: async () => ['t1'] }));
vi.mock('@/lib/stripe/client', () => ({ getAppUrl: () => 'http://localhost:3000' }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake }));

type Bal = {
  month: string;
  month_used: number;
  pack_balance: number;
  low_warned_at: string | null;
  out_warned_at: string | null;
};
let bal: Bal | null;
let waiting: number;
let fake: ReturnType<typeof build>;

function build() {
  return {
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      const isNull: string[] = [];
      const api: Record<string, unknown> = {
        select() {
          return api;
        },
        update(p: Record<string, unknown>) {
          patch = p;
          return api;
        },
        eq() {
          return api;
        },
        // Awaiting the chain directly: a count on messages, or a plain update (clear / put back).
        then(resolve: (v: unknown) => unknown) {
          if (table === 'messages') return Promise.resolve({ count: waiting, error: null }).then(resolve);
          if (patch) {
            const col = isNull[0] as keyof Bal | undefined;
            if (!col) Object.assign(bal ?? {}, patch);
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
        is(col: string) {
          isNull.push(col);
          return api;
        },
        maybeSingle() {
          if (!bal) return Promise.resolve({ data: null, error: null });
          if (patch) {
            const col = isNull[0] as keyof Bal;
            if (bal[col] != null) return Promise.resolve({ data: null, error: null });
            Object.assign(bal, patch);
            return Promise.resolve({ data: { tenant_id: 't1' }, error: null });
          }
          return Promise.resolve({ data: bal, error: null });
        },
      };
      return api;
    },
  };
}

const DAY = new Date('2026-11-18T12:00:00.000Z'); // 12:00 London
const NIGHT = new Date('2026-11-18T22:30:00.000Z');
const used = (n: number): Bal => ({
  month: '2026-11',
  month_used: n,
  pack_balance: 0,
  low_warned_at: null,
  out_warned_at: null,
});

async function load() {
  return import('@/lib/messaging/low-texts');
}

describe('checkTextWarnings', () => {
  beforeEach(() => {
    vi.resetModules();
    sendExpoPushMessages.mockClear();
    sendOwnerEmail.mockClear();
    sendOwnerEmail.mockResolvedValue({ ok: true });
    ownerEmailFor.mockResolvedValue('owner@example.com');
    getSoloWorkerForTenant.mockResolvedValue({ expo_push_token: 'ExponentPushToken[x]' });
    waiting = 0;
    bal = used(0);
    fake = build();
  });

  it('21 left → nothing', async () => {
    bal = used(79);
    const { checkTextWarnings } = await load();
    expect(await checkTextWarnings(fake as never, 't1', DAY)).toEqual({ sent: null });
    expect(sendOwnerEmail).not.toHaveBeenCalled();
  });

  it('20 left → one push and one email, and a second check sends nothing', async () => {
    bal = used(80);
    const { checkTextWarnings } = await load();
    expect(await checkTextWarnings(fake as never, 't1', DAY)).toEqual({ sent: 'low' });
    expect(sendExpoPushMessages).toHaveBeenCalledOnce();
    expect(sendOwnerEmail).toHaveBeenCalledOnce();
    expect(await checkTextWarnings(fake as never, 't1', DAY)).toEqual({ sent: null });
    expect(sendOwnerEmail).toHaveBeenCalledOnce();
  });

  it('0 left → the out warning once, no separate low warning', async () => {
    bal = used(100);
    waiting = 3;
    const { checkTextWarnings } = await load();
    expect(await checkTextWarnings(fake as never, 't1', DAY)).toEqual({ sent: 'out' });
    expect(bal.low_warned_at).not.toBeNull();
    expect(bal.out_warned_at).not.toBeNull();
    const pushed = sendExpoPushMessages.mock.calls[0] as unknown as [{ body: string }[]];
    expect(pushed[0]![0]!.body).toContain('3 messages are waiting');
    expect(await checkTextWarnings(fake as never, 't1', DAY)).toEqual({ sent: null });
  });

  it('back above 20 re-arms, then dropping again warns again', async () => {
    bal = used(80);
    const { checkTextWarnings } = await load();
    await checkTextWarnings(fake as never, 't1', DAY);
    bal.pack_balance = 300; // bought a pack
    await checkTextWarnings(fake as never, 't1', DAY);
    expect(bal.low_warned_at).toBeNull();
    bal.pack_balance = 0;
    expect(await checkTextWarnings(fake as never, 't1', DAY)).toEqual({ sent: 'low' });
    expect(sendOwnerEmail).toHaveBeenCalledTimes(2);
  });

  it('push fails but the email works → still counts as sent', async () => {
    bal = used(90);
    sendExpoPushMessages.mockRejectedValueOnce(new Error('expo down'));
    const { checkTextWarnings } = await load();
    expect(await checkTextWarnings(fake as never, 't1', DAY)).toEqual({ sent: 'low' });
  });

  it('nothing could be delivered → the flag is put back so the next check retries', async () => {
    bal = used(90);
    getSoloWorkerForTenant.mockResolvedValue({ expo_push_token: '' });
    sendOwnerEmail.mockResolvedValue({ ok: false });
    const { checkTextWarnings } = await load();
    expect(await checkTextWarnings(fake as never, 't1', DAY)).toEqual({ sent: null });
    expect(bal.low_warned_at).toBeNull();
  });

  it('quiet hours → nothing is claimed or sent', async () => {
    bal = used(90);
    const { checkTextWarnings } = await load();
    expect(await checkTextWarnings(fake as never, 't1', NIGHT)).toEqual({ sent: null });
    expect(bal.low_warned_at).toBeNull();
    expect(sendOwnerEmail).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    ownerEmailFor.mockRejectedValue(new Error('db'));
    bal = used(90);
    const { checkTextWarnings } = await load();
    await expect(checkTextWarnings(fake as never, 't1', DAY)).resolves.toBeDefined();
  });
});
