import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const connection = { value: { status: 'connected', verification_status: 'successful' } as Record<string, unknown> | null };
vi.mock('@/lib/gocardless/connection', () => ({
  getConnection: async () => connection.value,
}));

import { loadChaserMoney, workingDirectDebit } from '@/lib/direct-debit/state';

const T = 'tenant-1';
const NOW = new Date('2026-10-01T18:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let failTable: string | null = null;

function fakeAdmin(): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    const run = (single: boolean) => {
      if (table === failTable) return { data: null, error: { code: 'XX000' } };
      const hit = db[table].filter((r) => filters.every((f) => f(r)));
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      maybeSingle: async () => run(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

beforeEach(() => {
  connection.value = { status: 'connected', verification_status: 'successful' };
  failTable = null;
  db = {
    customer_direct_debits: [
      { tenant_id: T, customer_id: 'active', status: 'active' },
      { tenant_id: T, customer_id: 'pending', status: 'pending' },
      { tenant_id: T, customer_id: 'cancelled', status: 'cancelled' },
      { tenant_id: T, customer_id: 'left-old', status: 'active' },
      { tenant_id: T, customer_id: 'left-new', status: 'active' },
      { tenant_id: T, customer_id: 'held', status: 'active' },
      { tenant_id: T, customer_id: 'resolved-again', status: 'active' },
    ],
    direct_debit_collections: [
      { tenant_id: T, customer_id: 'left-old', status: 'failed', amount: 15, resolution: 'left', resolved_at: daysAgo(90) },
      { tenant_id: T, customer_id: 'left-new', status: 'failed', amount: 15, resolution: 'left', resolved_at: daysAgo(10) },
      { tenant_id: T, customer_id: 'held', status: 'failed', amount: 15, resolution: null, resolved_at: null },
      { tenant_id: T, customer_id: 'resolved-again', status: 'failed', amount: 15, resolution: 'collect_again', resolved_at: daysAgo(1) },
      { tenant_id: T, customer_id: 'active', status: 'processing', amount: 5 },
      { tenant_id: T, customer_id: 'active', status: 'creating', amount: 2.5 },
    ],
    gocardless_pay_requests: [{ tenant_id: T, customer_id: 'active', status: 'fulfilled', amount: 3 }],
  };
});

describe('workingDirectDebit', () => {
  const at = (id: string) => workingDirectDebit(fakeAdmin(), T, id, NOW);

  it('active and pending are working; cancelled and none are not', async () => {
    expect(await at('active')).toBe('active');
    expect(await at('pending')).toBe('pending');
    expect(await at('cancelled')).toBeNull();
    expect(await at('nobody')).toBeNull();
  });

  it('a failure the trader left (last 60 days) or has not decided on stops it; an old one does not', async () => {
    expect(await at('left-new')).toBeNull();
    expect(await at('held')).toBeNull();
    expect(await at('left-old')).toBe('active');
    expect(await at('resolved-again')).toBe('active');
  });

  it('not when the business is not On, and safe on any read error', async () => {
    connection.value = { status: 'connected', verification_status: 'action_required' };
    expect(await at('active')).toBeNull();
    connection.value = { status: 'disconnected', verification_status: 'successful' };
    expect(await at('active')).toBeNull();
    connection.value = { status: 'connected', verification_status: 'successful' };
    failTable = 'direct_debit_collections';
    expect(await at('active')).toBeNull();
  });
});

describe('loadChaserMoney', () => {
  const owed = (entries: [string, number][]) => new Map(entries);

  it('subtracts collecting, undecided failures and approved Pay by Bank; never below zero', async () => {
    const out = await loadChaserMoney(fakeAdmin(), T, owed([['active', 20], ['held', 20], ['nobody', 12], ['pending', 1]]), NOW);
    expect(out?.get('active')?.chaseAmount).toBe(9.5); // 20 − 5 − 2.5 − 3
    expect(out?.get('held')?.chaseAmount).toBe(5); // 20 − 15 (waiting for the trader)
    expect(out?.get('nobody')).toEqual({ directDebitWorking: false, chaseAmount: 12 });
    expect(out?.get('pending')?.chaseAmount).toBe(1);
    const small = await loadChaserMoney(fakeAdmin(), T, owed([['active', 4]]), NOW);
    expect(small?.get('active')?.chaseAmount).toBe(0);
  });

  it('working Direct Debit rule: active/pending yes; cancelled no; left in the last 60 days no (chased); left long ago yes', async () => {
    const out = await loadChaserMoney(
      fakeAdmin(),
      T,
      owed([['active', 15], ['pending', 15], ['cancelled', 15], ['left-new', 15], ['left-old', 15]]),
      NOW,
    );
    const working = Object.fromEntries([...(out ?? [])].map(([id, m]) => [id, m.directDebitWorking]));
    expect(working).toEqual({ active: true, pending: true, cancelled: false, 'left-new': false, 'left-old': true });
    // A failure the trader left is not subtracted: it is still owed and gets chased.
    expect(out?.get('left-new')?.chaseAmount).toBe(15);
  });

  it('a business that is not On means nobody counts as covered', async () => {
    connection.value = null;
    const out = await loadChaserMoney(fakeAdmin(), T, owed([['active', 15]]), NOW);
    expect(out?.get('active')?.directDebitWorking).toBe(false);
  });

  it('returns null on a read error so the chasers send nothing', async () => {
    failTable = 'gocardless_pay_requests';
    expect(await loadChaserMoney(fakeAdmin(), T, owed([['active', 15]]), NOW)).toBeNull();
  });
});
