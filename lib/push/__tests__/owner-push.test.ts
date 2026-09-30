import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendExpoPushMessages = vi.fn(async (_messages: unknown[]) => {
  void _messages;
});
vi.mock('@/lib/services/expo-push', () => ({
  sendExpoPushMessages: (messages: unknown[]) => sendExpoPushMessages(messages),
}));

import {
  groupedCardPush,
  groupedDirectDebitPush,
  sendDueOwnerPushes,
  sendOrHoldOwnerPush,
  type OwnerPush,
} from '@/lib/push/owner-push';

const TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const TOKEN = 'ExponentPushToken[aaa]';
const TOKEN_B = 'ExponentPushToken[bbb]';

type Row = Record<string, unknown>;
type FakeDb = { workers: Row[]; owner_pushes: Row[] };

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'is'; col: string; val: unknown }
  | { kind: 'lte'; col: string; val: string };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.kind === 'eq') return v === f.val;
    if (f.kind === 'is') return f.val === null ? v == null : v === f.val;
    return typeof v === 'string' && v <= f.val;
  });
}

function fakeAdmin(db: FakeDb): SupabaseClient {
  const from = (table: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;
    const filters: Filter[] = [];

    const finish = async (single: boolean) => {
      const rows = (db as unknown as Record<string, Row[]>)[table] ?? [];
      if (op === 'insert') {
        rows.push({ id: `p${rows.length + 1}`, sent_at: null, created_at: new Date().toISOString(), ...payload });
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => matches(r, filters));
      if (op === 'update') for (const r of hit) Object.assign(r, payload);
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };

    const builder = {
      select() {
        return builder;
      },
      insert(row: Row) {
        op = 'insert';
        payload = row;
        return builder;
      },
      update(row: Row) {
        op = 'update';
        payload = row;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ kind: 'eq', col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push({ kind: 'is', col, val });
        return builder;
      },
      lte(col: string, val: string) {
        filters.push({ kind: 'lte', col, val });
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return finish(true);
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return finish(false).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function worker(tenantId: string, token: string | null): Row {
  return {
    id: `w-${tenantId}`,
    primary_tenant_id: tenantId,
    worker_type: 'platform_solo',
    full_name: 'Sam',
    expo_push_token: token,
  };
}

const cardPush = (amount: number, name = 'Mrs Wright'): OwnerPush => ({
  kind: 'card_payment',
  title: 'Card payment received',
  body: `£${amount} from ${name}`,
  data: { type: 'card_payment', amount, customerName: name },
});

function held(tenantId: string, push: OwnerPush, createdAt: string, sendAfter = '2026-07-16T06:00:00.000Z'): Row {
  return {
    id: `h-${createdAt}`,
    tenant_id: tenantId,
    kind: push.kind,
    title: push.title,
    body: push.body,
    data: push.data,
    send_after: sendAfter,
    sent_at: null,
    created_at: createdAt,
  };
}

beforeEach(() => {
  sendExpoPushMessages.mockClear();
});

describe('sendOrHoldOwnerPush: quiet hours', () => {
  const cases: [string, string, 'sent' | 'held', string | null][] = [
    // BST (UTC+1)
    ['BST 20:59', '2026-07-15T19:59:00Z', 'sent', null],
    ['BST 21:00', '2026-07-15T20:00:00Z', 'held', '2026-07-16T06:00:00.000Z'],
    ['BST 06:59', '2026-07-16T05:59:00Z', 'held', '2026-07-16T06:00:00.000Z'],
    ['BST 07:00', '2026-07-16T06:00:00Z', 'sent', null],
    // GMT (UTC+0)
    ['GMT 20:59', '2026-01-15T20:59:00Z', 'sent', null],
    ['GMT 21:00', '2026-01-15T21:00:00Z', 'held', '2026-01-16T07:00:00.000Z'],
    ['GMT 06:59', '2026-01-16T06:59:00Z', 'held', '2026-01-16T07:00:00.000Z'],
    ['GMT 07:00', '2026-01-16T07:00:00Z', 'sent', null],
  ];

  for (const [label, at, expected, sendAfter] of cases) {
    it(`${label} London → ${expected}`, async () => {
      const db: FakeDb = { workers: [worker(TENANT, TOKEN)], owner_pushes: [] };
      const result = await sendOrHoldOwnerPush(fakeAdmin(db), TENANT, cardPush(15), new Date(at));
      expect(result).toBe(expected);
      if (expected === 'sent') {
        expect(db.owner_pushes).toHaveLength(0);
        expect(sendExpoPushMessages).toHaveBeenCalledWith([
          expect.objectContaining({
            to: TOKEN,
            title: 'Card payment received',
            body: '£15 from Mrs Wright',
            data: expect.objectContaining({ type: 'card_payment', amount: 15 }),
          }),
        ]);
      } else {
        expect(sendExpoPushMessages).not.toHaveBeenCalled();
        expect(db.owner_pushes).toHaveLength(1);
        expect(db.owner_pushes[0]).toMatchObject({
          tenant_id: TENANT,
          kind: 'card_payment',
          send_after: sendAfter,
        });
      }
    });
  }

  it('no push token → no_token and nothing stored', async () => {
    const db: FakeDb = { workers: [worker(TENANT, '  ')], owner_pushes: [] };
    const night = new Date('2026-07-15T22:00:00Z');
    expect(await sendOrHoldOwnerPush(fakeAdmin(db), TENANT, cardPush(15), night)).toBe('no_token');
    expect(db.owner_pushes).toHaveLength(0);
    expect(sendExpoPushMessages).not.toHaveBeenCalled();

    const noWorker: FakeDb = { workers: [], owner_pushes: [] };
    expect(
      await sendOrHoldOwnerPush(fakeAdmin(noWorker), TENANT, cardPush(15), new Date('2026-07-15T10:00:00Z')),
    ).toBe('no_token');
  });

  it('a failed Expo send returns failed and never throws', async () => {
    sendExpoPushMessages.mockRejectedValueOnce(new Error('network'));
    const db: FakeDb = { workers: [worker(TENANT, TOKEN)], owner_pushes: [] };
    expect(
      await sendOrHoldOwnerPush(fakeAdmin(db), TENANT, cardPush(15), new Date('2026-07-15T10:00:00Z')),
    ).toBe('failed');
  });
});

describe('grouped wording', () => {
  it('card payments', () => {
    expect(groupedCardPush([15, 20, 25])).toEqual({
      title: 'Card payments',
      body: '3 card payments came in overnight (£60)',
    });
  });

  it('Direct Debits: one and several', () => {
    expect(groupedDirectDebitPush([15], 'Mrs Wright')).toEqual({
      title: 'Direct Debit received',
      body: '£15 from Mrs Wright',
    });
    expect(groupedDirectDebitPush([15, 15, 15])).toEqual({
      title: 'Direct Debits',
      body: '3 Direct Debits came in (£45)',
    });
  });

  it('adds pence without floating-point drift', () => {
    expect(groupedCardPush([0.1, 0.2]).body).toBe('2 card payments came in overnight (£0.30)');
  });
});

describe('sendDueOwnerPushes', () => {
  const morning = new Date('2026-07-16T06:00:00Z');

  it('groups several card payments for one business into one push', async () => {
    const db: FakeDb = {
      workers: [worker(TENANT, TOKEN)],
      owner_pushes: [
        held(TENANT, cardPush(15), '2026-07-15T21:10:00Z'),
        held(TENANT, cardPush(20, 'Mr Jones'), '2026-07-15T22:10:00Z'),
        held(TENANT, cardPush(25, 'Ms Patel'), '2026-07-15T23:10:00Z'),
      ],
    };
    expect(await sendDueOwnerPushes(fakeAdmin(db), morning)).toEqual({ sent: 1 });
    expect(sendExpoPushMessages).toHaveBeenCalledTimes(1);
    expect(sendExpoPushMessages.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        to: TOKEN,
        title: 'Card payments',
        body: '3 card payments came in overnight (£60)',
      }),
    ]);
    expect(db.owner_pushes.every((r) => r.sent_at === morning.toISOString())).toBe(true);
  });

  it('a single held card payment keeps its own wording', async () => {
    const db: FakeDb = {
      workers: [worker(TENANT, TOKEN)],
      owner_pushes: [held(TENANT, cardPush(15), '2026-07-15T22:30:00Z')],
    };
    await sendDueOwnerPushes(fakeAdmin(db), morning);
    expect(sendExpoPushMessages.mock.calls[0][0]).toEqual([
      expect.objectContaining({ title: 'Card payment received', body: '£15 from Mrs Wright' }),
    ]);
  });

  it('groups Direct Debits, sends others one each, per business', async () => {
    const dd = (amount: number): OwnerPush => ({
      kind: 'dd_payment',
      title: 'Direct Debit received',
      body: `£${amount} from someone`,
      data: { type: 'dd_payment', amount },
    });
    const failed: OwnerPush = {
      kind: 'dd_failed',
      title: 'Direct Debit failed',
      body: '£15 from Mrs Wright',
      data: { type: 'dd_failed', amount: 15 },
    };
    const db: FakeDb = {
      workers: [worker(TENANT, TOKEN), worker(TENANT_B, TOKEN_B)],
      owner_pushes: [
        held(TENANT, dd(15), '2026-07-15T21:01:00Z'),
        held(TENANT, failed, '2026-07-15T21:02:00Z'),
        held(TENANT, dd(15), '2026-07-15T21:03:00Z'),
        held(TENANT, failed, '2026-07-15T21:04:00Z'),
        held(TENANT_B, cardPush(10), '2026-07-15T21:05:00Z'),
      ],
    };
    expect(await sendDueOwnerPushes(fakeAdmin(db), morning)).toEqual({ sent: 4 });
    const sent = sendExpoPushMessages.mock.calls[0][0] as { to: string; title: string; body: string }[];
    expect(sent.filter((m) => m.to === TOKEN).map((m) => m.title)).toEqual([
      'Direct Debits',
      'Direct Debit failed',
      'Direct Debit failed',
    ]);
    expect(sent.find((m) => m.title === 'Direct Debits')?.body).toBe('2 Direct Debits came in (£30)');
    expect(sent.filter((m) => m.to === TOKEN_B)).toEqual([
      expect.objectContaining({ title: 'Card payment received' }),
    ]);
  });

  it('caps one business at 5 pushes plus one "and N more"', async () => {
    const attention = (i: number): OwnerPush => ({
      kind: 'dd_attention',
      title: `Warning ${i}`,
      body: 'Check GoCardless',
      data: { type: 'dd_attention' },
    });
    const db: FakeDb = {
      workers: [worker(TENANT, TOKEN)],
      owner_pushes: Array.from({ length: 8 }, (_, i) =>
        held(TENANT, attention(i), `2026-07-15T21:0${i}:00Z`),
      ),
    };
    expect(await sendDueOwnerPushes(fakeAdmin(db), morning)).toEqual({ sent: 6 });
    const sent = sendExpoPushMessages.mock.calls[0][0] as { title: string; body: string }[];
    expect(sent.slice(0, 5).map((m) => m.title)).toEqual([
      'Warning 0',
      'Warning 1',
      'Warning 2',
      'Warning 3',
      'Warning 4',
    ]);
    expect(sent[5]).toMatchObject({ body: 'And 3 more — open WorkWise to see them.' });
  });

  it('claims once: a second run sends nothing', async () => {
    const db: FakeDb = {
      workers: [worker(TENANT, TOKEN)],
      owner_pushes: [held(TENANT, cardPush(15), '2026-07-15T22:30:00Z')],
    };
    const admin = fakeAdmin(db);
    expect(await sendDueOwnerPushes(admin, morning)).toEqual({ sent: 1 });
    expect(await sendDueOwnerPushes(admin, morning)).toEqual({ sent: 0 });
    expect(sendExpoPushMessages).toHaveBeenCalledTimes(1);
  });

  it('leaves pushes that are not due yet', async () => {
    const db: FakeDb = {
      workers: [worker(TENANT, TOKEN)],
      owner_pushes: [held(TENANT, cardPush(15), '2026-07-15T22:30:00Z', '2026-07-16T06:00:00.000Z')],
    };
    expect(await sendDueOwnerPushes(fakeAdmin(db), new Date('2026-07-16T05:59:00Z'))).toEqual({ sent: 0 });
    expect(db.owner_pushes[0].sent_at).toBeNull();
  });

  it('a failed Expo send keeps sent_at (never sent twice) and never throws', async () => {
    sendExpoPushMessages.mockRejectedValueOnce(new Error('network'));
    const db: FakeDb = {
      workers: [worker(TENANT, TOKEN)],
      owner_pushes: [held(TENANT, cardPush(15), '2026-07-15T22:30:00Z')],
    };
    expect(await sendDueOwnerPushes(fakeAdmin(db), morning)).toEqual({ sent: 0 });
    expect(db.owner_pushes[0].sent_at).toBe(morning.toISOString());
  });
});
