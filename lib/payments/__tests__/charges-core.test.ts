import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addChargeCore,
  STARTING_BALANCE_DESCRIPTION,
  voidChargeCore,
} from '@/lib/payments/charges-core';
import { composeChaserMessage, composeShareMessage } from '@/lib/payments/messages';
import { chaserSms } from '@/lib/messaging/templates';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const CHARGE = '66666666-6666-6666-6666-666666666666';
const USER = '77777777-7777-7777-7777-777777777777';

type FakeDb = {
  customers: Record<string, unknown>[];
  customer_charges: Record<string, unknown>[];
  /** Simulates a worker login: RLS refuses inserts, hides updates. */
  notAdmin?: boolean;
};

function createFakeSupabase(db: FakeDb): SupabaseClient {
  const from = (table: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Record<string, unknown> | null = null;
    const filters: { col: string; val: unknown }[] = [];
    let wantSingle = false;

    const rowsOf = () =>
      ((db as unknown as Record<string, Record<string, unknown>[]>)[table] ?? []).filter(
        (r) => filters.every((f) => r[f.col] === f.val),
      );

    const finish = async () => {
      if (op === 'insert') {
        if (db.notAdmin) {
          return {
            data: null,
            error: {
              code: '42501',
              message: 'new row violates row-level security policy for table "customer_charges"',
            },
          };
        }
        const row = { id: CHARGE, status: 'active', ...payload };
        db.customer_charges.push(row);
        return { data: wantSingle ? { id: row.id } : [{ id: row.id }], error: null };
      }
      if (op === 'update') {
        const rows = db.notAdmin ? [] : rowsOf();
        for (const row of rows) Object.assign(row, payload);
        return { data: wantSingle ? (rows[0] ?? null) : rows, error: null };
      }
      const rows = rowsOf();
      return { data: wantSingle ? (rows[0] ?? null) : rows, error: null };
    };

    const builder = {
      select(_columns?: string) {
        void _columns;
        return builder;
      },
      insert(row: Record<string, unknown>) {
        op = 'insert';
        payload = row;
        return builder;
      },
      update(row: Record<string, unknown>) {
        op = 'update';
        payload = row;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return builder;
      },
      maybeSingle() {
        wantSingle = true;
        return finish();
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return finish().then(resolve, reject);
      },
    };
    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

function freshDb(): FakeDb {
  return {
    customers: [{ id: CUSTOMER, tenant_id: TENANT }],
    customer_charges: [],
  };
}

const base = {
  tenantId: TENANT,
  customerId: CUSTOMER,
  description: STARTING_BALANCE_DESCRIPTION,
  amount: 15,
  chargeDate: '2026-09-01',
  kind: 'starting_balance' as const,
  userId: USER,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('addChargeCore', () => {
  it('inserts the charge with the caller client and returns its id', async () => {
    const db = freshDb();
    const result = await addChargeCore(createFakeSupabase(db), {
      ...base,
      amount: 15.004,
    });
    expect(result).toEqual({ success: true, chargeId: CHARGE });
    expect(db.customer_charges[0]).toMatchObject({
      tenant_id: TENANT,
      customer_id: CUSTOMER,
      kind: 'starting_balance',
      description: 'Owed from before WorkWise',
      amount: 15,
      charge_date: '2026-09-01',
      created_by_user_id: USER,
    });
  });

  it('refuses a date after today in London', async () => {
    vi.useFakeTimers();
    // 23:30 UTC on 30 Sep = 00:30 on 1 Oct in London (BST).
    vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
    const db = freshDb();
    const ok = await addChargeCore(createFakeSupabase(db), {
      ...base,
      chargeDate: '2026-10-01',
    });
    expect(ok.success).toBe(true);

    const future = await addChargeCore(createFakeSupabase(freshDb()), {
      ...base,
      chargeDate: '2026-10-02',
    });
    expect(future).toEqual({ success: false, error: "The date can't be in the future." });
  });

  it('refuses zero (and amounts that round to zero)', async () => {
    const db = freshDb();
    expect(await addChargeCore(createFakeSupabase(db), { ...base, amount: 0 })).toEqual({
      success: false,
      error: 'Enter an amount over £0.',
    });
    expect(await addChargeCore(createFakeSupabase(db), { ...base, amount: 0.004 })).toEqual({
      success: false,
      error: 'Enter an amount over £0.',
    });
    expect(db.customer_charges).toHaveLength(0);
  });

  it("refuses another business's customer", async () => {
    const db = freshDb();
    const result = await addChargeCore(createFakeSupabase(db), {
      ...base,
      tenantId: OTHER_TENANT,
    });
    expect(result).toEqual({ success: false, error: 'Customer not found.' });
    expect(db.customer_charges).toHaveLength(0);
  });

  it('turns an RLS refusal (worker login) into the owner-only message', async () => {
    const db = { ...freshDb(), notAdmin: true };
    const result = await addChargeCore(createFakeSupabase(db), base);
    expect(result).toEqual({
      success: false,
      error: 'Only the account owner can change this.',
    });
  });
});

describe('voidChargeCore', () => {
  function dbWithCharge(): FakeDb {
    return {
      ...freshDb(),
      customer_charges: [
        {
          id: CHARGE,
          tenant_id: TENANT,
          customer_id: CUSTOMER,
          status: 'active',
          voided_at: null,
          voided_by_user_id: null,
        },
      ],
    };
  }

  it('voids an active charge', async () => {
    const db = dbWithCharge();
    const result = await voidChargeCore(createFakeSupabase(db), {
      tenantId: TENANT,
      chargeId: CHARGE,
      userId: USER,
    });
    expect(result).toEqual({ success: true });
    expect(db.customer_charges[0]).toMatchObject({
      status: 'void',
      voided_by_user_id: USER,
    });
    expect(typeof db.customer_charges[0].voided_at).toBe('string');
  });

  it('succeeds when voided twice', async () => {
    const db = dbWithCharge();
    const client = createFakeSupabase(db);
    const p = { tenantId: TENANT, chargeId: CHARGE, userId: USER };
    expect(await voidChargeCore(client, p)).toEqual({ success: true });
    const firstVoidedAt = db.customer_charges[0].voided_at;
    expect(await voidChargeCore(client, p)).toEqual({ success: true });
    expect(db.customer_charges[0].voided_at).toBe(firstVoidedAt);
  });

  it("can't void another business's charge", async () => {
    const db = dbWithCharge();
    const result = await voidChargeCore(createFakeSupabase(db), {
      tenantId: OTHER_TENANT,
      chargeId: CHARGE,
      userId: USER,
    });
    expect(result).toEqual({ success: false, error: 'Amount owed not found.' });
    expect(db.customer_charges[0].status).toBe('active');
  });

  it('a worker login (RLS hides the update) gets the owner-only message', async () => {
    const db = { ...dbWithCharge(), notAdmin: true };
    const result = await voidChargeCore(createFakeSupabase(db), {
      tenantId: TENANT,
      chargeId: CHARGE,
      userId: USER,
    });
    expect(result).toEqual({
      success: false,
      error: 'Only the account owner can change this.',
    });
    expect(db.customer_charges[0].status).toBe('active');
  });
});

describe('chaser wording', () => {
  const payUrl = `https://app.joinworkwise.com/pay/${'c'.repeat(32)}`;
  const common = {
    businessName: 'Sparkle Windows',
    customerName: 'Jane Wright',
    owed: 15,
    payUrl,
    bank: null,
    reference: null,
  };

  it('email: visits by default', () => {
    expect(composeChaserMessage({ ...common, stage: 1 }).paragraphs[0]).toBe(
      "Just a friendly reminder that there's £15 to pay for your recent visits.",
    );
    expect(composeChaserMessage({ ...common, stage: 2 }).paragraphs[0]).toBe(
      "Just a nudge: £15 is still to pay for your recent visits. If you've already paid, thank you, and please ignore this.",
    );
  });

  it('email: only other amounts owed', () => {
    expect(
      composeChaserMessage({ ...common, stage: 1, forVisits: false }).paragraphs[0],
    ).toBe("Just a friendly reminder that there's £15 to pay.");
    expect(
      composeChaserMessage({ ...common, stage: 2, forVisits: false }).paragraphs[0],
    ).toBe(
      "Just a nudge: £15 is still to pay. If you've already paid, thank you, and please ignore this.",
    );
  });

  it('text: says "recent visits" only when a visit is owed', () => {
    const brand = { businessName: 'Sparkle Windows', contactPhone: null };
    expect(chaserSms({ brand, owed: 15, payUrl, stage: 1 })).toContain(
      'for your recent visits',
    );
    const other = chaserSms({ brand, owed: 15, payUrl, stage: 1, forVisits: false });
    expect(other).not.toContain('visit');
    expect(other).toContain(`£15 to pay. Pay here: ${payUrl}`);
  });

  it('share message never says "0 visits"', () => {
    const msg = composeShareMessage({
      businessName: 'Sparkle Windows',
      customerName: 'Jane Wright',
      owedTotal: 15,
      unpaidVisits: 0,
      payUrl,
      bank: null,
      reference: null,
    });
    expect(msg).toBe(
      `Hi Jane, it's Sparkle Windows. There's £15 to pay. Pay online: ${payUrl}. Thanks!`,
    );
  });
});
