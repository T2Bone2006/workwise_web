import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ensurePaymentReference,
  recordPaymentCore,
  voidPaymentCore,
} from '@/lib/payments/money-core';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const JOB = '44444444-4444-4444-4444-444444444444';
const PAYMENT = '55555555-5555-5555-5555-555555555555';

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'is'; col: string; val: unknown }
  | { kind: 'not'; col: string; op: string; val: unknown };

type FakeDb = {
  customers: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  forceReferenceConflictOnce?: boolean;
};

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  for (const filter of filters) {
    const value = row[filter.col];
    if (filter.kind === 'eq' && value !== filter.val) return false;
    if (filter.kind === 'is') {
      if (filter.val === null && value != null) return false;
      if (filter.val !== null && value !== filter.val) return false;
    }
    if (
      filter.kind === 'not' &&
      filter.op === 'is' &&
      filter.val === null &&
      value == null
    ) {
      return false;
    }
  }
  return true;
}

function createFakeSupabase(db: FakeDb): SupabaseClient {
  const from = (table: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: unknown = null;
    const filters: Filter[] = [];
    let wantSingle = false;

    const finish = async () => {
      if (table === 'customers') {
        if (op === 'select') {
          const rows = db.customers.filter((r) => matches(r, filters));
          if (wantSingle) {
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows, error: null };
        }
        if (op === 'update') {
          const rows = db.customers.filter((r) => matches(r, filters));
          if (
            db.forceReferenceConflictOnce &&
            payload &&
            typeof payload === 'object' &&
            'bank_reference_hint' in (payload as object)
          ) {
            db.forceReferenceConflictOnce = false;
            return {
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "uq_customers_tenant_bank_reference"',
              },
            };
          }
          for (const row of rows) {
            Object.assign(row, payload as object);
          }
          if (wantSingle) {
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows, error: null };
        }
      }

      if (table === 'jobs') {
        const rows = db.jobs.filter((r) => matches(r, filters));
        return { data: wantSingle ? (rows[0] ?? null) : rows, error: null };
      }

      if (table === 'payments') {
        if (op === 'insert') {
          const row = {
            id: PAYMENT,
            ...(payload as Record<string, unknown>),
          };
          const mutationId = (row as Record<string, unknown>).client_mutation_id;
          if (
            typeof mutationId === 'string' &&
            db.payments.some((p) => p.client_mutation_id === mutationId)
          ) {
            return {
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "payments_client_mutation_id_key"',
              },
            };
          }
          db.payments.push(row);
          return { data: wantSingle ? { id: row.id } : [row], error: null };
        }
        if (op === 'select') {
          const rows = db.payments.filter((r) => matches(r, filters));
          return {
            data: wantSingle ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        if (op === 'update') {
          const rows = db.payments.filter((r) => matches(r, filters));
          for (const row of rows) Object.assign(row, payload as object);
          return { data: wantSingle ? (rows[0] ?? null) : rows, error: null };
        }
      }

      return { data: wantSingle ? null : [], error: null };
    };

    const builder = {
      select(_columns?: string) {
        void _columns;
        return builder;
      },
      insert(rows: unknown) {
        op = 'insert';
        payload = Array.isArray(rows) ? rows[0] : rows;
        return builder;
      },
      update(row: unknown) {
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
      not(col: string, opName: string, val: unknown) {
        filters.push({ kind: 'not', col, op: opName, val });
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

describe('recordPaymentCore', () => {
  it('returns duplicate: true when client_mutation_id already exists', async () => {
    const db: FakeDb = {
      customers: [{ id: CUSTOMER, tenant_id: TENANT }],
      jobs: [{ id: JOB, tenant_id: TENANT, customer_id: CUSTOMER }],
      payments: [
        {
          id: PAYMENT,
          tenant_id: TENANT,
          customer_id: CUSTOMER,
          client_mutation_id: 'mutation-abc-123',
        },
      ],
    };
    const result = await recordPaymentCore(createFakeSupabase(db), {
      tenantId: TENANT,
      customerId: CUSTOMER,
      amount: 18,
      method: 'cash',
      clientMutationId: 'mutation-abc-123',
      userId: 'user-1',
      appliesToJobId: JOB,
    });
    expect(result).toEqual({
      success: true,
      paymentId: PAYMENT,
      duplicate: true,
    });
    expect(db.payments).toHaveLength(1);
  });
});

describe('voidPaymentCore', () => {
  it('refuses to void a Stripe payment', async () => {
    const db: FakeDb = {
      customers: [],
      jobs: [],
      payments: [
        {
          id: PAYMENT,
          tenant_id: TENANT,
          status: 'active',
          source: 'stripe',
        },
      ],
    };
    const result = await voidPaymentCore(createFakeSupabase(db), {
      tenantId: TENANT,
      paymentId: PAYMENT,
      userId: 'user-1',
    });
    expect(result).toEqual({
      success: false,
      error: 'Card payments are refunded in Stripe, not undone here.',
    });
  });
});

describe('ensurePaymentReference', () => {
  it('returns the existing value without writing', async () => {
    const db: FakeDb = {
      customers: [
        {
          id: CUSTOMER,
          tenant_id: TENANT,
          name: 'Sarah Smith',
          company_name: null,
          bank_reference_hint: 'SMITH12',
        },
      ],
      jobs: [],
      payments: [],
    };
    const supabase = createFakeSupabase(db);
    const updateSpy = vi.fn();
    const originalFrom = supabase.from.bind(supabase);
    (supabase as { from: typeof supabase.from }).from = ((table: string) => {
      const builder = originalFrom(table) as ReturnType<typeof originalFrom> & {
        update: (row: unknown) => unknown;
      };
      const originalUpdate = builder.update.bind(builder);
      builder.update = (row: unknown) => {
        updateSpy(row);
        return originalUpdate(row);
      };
      return builder;
    }) as typeof supabase.from;

    const ref = await ensurePaymentReference(supabase, {
      tenantId: TENANT,
      customerId: CUSTOMER,
    });
    expect(ref).toBe('SMITH12');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('retries with a different reference after a forced 23505', async () => {
    const db: FakeDb = {
      customers: [
        {
          id: CUSTOMER,
          tenant_id: TENANT,
          name: 'Sarah Smith',
          company_name: null,
          bank_reference_hint: null,
        },
        {
          id: '66666666-6666-6666-6666-666666666666',
          tenant_id: TENANT,
          name: 'Other',
          company_name: null,
          bank_reference_hint: 'SMITH10',
        },
      ],
      jobs: [],
      payments: [],
      forceReferenceConflictOnce: true,
    };

    let call = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      // First successful make after conflict: still 10 → collide with taken SMITH10,
      // but our conflict is forced once on update; second attempt uses 0.5 → 55.
      call += 1;
      return call === 1 ? 0 : 0.5;
    });

    try {
      const ref = await ensurePaymentReference(createFakeSupabase(db), {
        tenantId: TENANT,
        customerId: CUSTOMER,
      });
      expect(ref).toMatch(/^SMITH\d{2,3}$/);
      const customer = db.customers.find((c) => c.id === CUSTOMER)!;
      expect(customer.bank_reference_hint).toBe(ref);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
