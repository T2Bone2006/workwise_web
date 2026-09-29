import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  completeVisitCore,
  skipVisitCore,
} from '@/lib/rounds/visit-transitions';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const JOB = '44444444-4444-4444-4444-444444444444';
const ACTOR = { userId: 'user-1' };

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'is'; col: string; val: unknown }
  | { kind: 'notIn'; col: string; val: string[] };

type FakeDb = {
  customers: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  history: Record<string, unknown>[];
  nextPaymentId: number;
  /** Race: the first jobs read sees this status; the stored row keeps its real one. */
  staleStatusOnce?: string;
  /** Payments insert fails with a server error. */
  failPaymentInsert?: boolean;
};

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  for (const filter of filters) {
    const value = row[filter.col];
    if (filter.kind === 'eq' && value !== filter.val) return false;
    if (filter.kind === 'is') {
      if (filter.val === null && value != null) return false;
      if (filter.val !== null && value !== filter.val) return false;
    }
    if (filter.kind === 'notIn' && filter.val.includes(String(value))) return false;
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
          return { data: wantSingle ? (rows[0] ?? null) : rows, error: null };
        }
        if (op === 'update') {
          const rows = db.customers.filter((r) => matches(r, filters));
          for (const row of rows) Object.assign(row, payload as object);
          return { data: wantSingle ? (rows[0] ?? null) : rows, error: null };
        }
      }

      if (table === 'jobs') {
        if (op === 'select') {
          let rows = db.jobs.filter((r) => matches(r, filters));
          if (db.staleStatusOnce) {
            rows = rows.map((r) => ({ ...r, status: db.staleStatusOnce }));
            db.staleStatusOnce = undefined;
          }
          return { data: wantSingle ? (rows[0] ?? null) : rows, error: null };
        }
        if (op === 'update') {
          const rows = db.jobs.filter((r) => matches(r, filters));
          for (const row of rows) Object.assign(row, payload as object);
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }
      }

      if (table === 'payments') {
        if (op === 'insert' && db.failPaymentInsert) {
          return { data: null, error: { code: 'XX000', message: 'server closed the connection' } };
        }
        if (op === 'insert') {
          const row = {
            id: `pay-${db.nextPaymentId++}`,
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
          return { data: wantSingle ? (rows[0] ?? null) : rows, error: null };
        }
      }

      if (table === 'job_status_history' && op === 'insert') {
        db.history.push(payload as Record<string, unknown>);
        return { data: null, error: null };
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
      not(col: string, operator: string, val: unknown) {
        if (operator === 'in') {
          const list = String(val).replace(/^\(|\)$/g, '').split(',');
          filters.push({ kind: 'notIn', col, val: list });
        }
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

function baseDb(jobStatus: string): FakeDb {
  return {
    customers: [
      {
        id: CUSTOMER,
        tenant_id: TENANT,
        payment_terms: 'on_the_day',
        name: 'Sarah Smith',
      },
    ],
    jobs: [
      {
        id: JOB,
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        status: jobStatus,
        scheduled_date: '2026-09-15',
        scheduled_time: null,
        service_agreement_id: null,
        route_position: 1,
        completed_at: null,
      },
    ],
    payments: [],
    history: [],
    nextPaymentId: 1,
  };
}

describe('completeVisitCore payment paths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancelled job + payment → payment recorded, job not updated', async () => {
    const db = baseDb('cancelled');
    const result = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cash', amount: 18 },
      clientMutationId: 'mutation-cash-001',
    });
    expect(result).toEqual({
      success: true,
      alreadyCompleted: false,
      skippedElsewhere: true,
      paymentId: 'pay-1',
      paymentDuplicate: false,
    });
    expect(db.jobs[0]?.status).toBe('cancelled');
    expect(db.jobs[0]?.completed_at).toBeNull();
    expect(db.payments).toHaveLength(1);
    expect(db.payments[0]).toMatchObject({
      applies_to_job_id: JOB,
      amount: 18,
      method: 'cash',
      client_mutation_id: 'mutation-cash-001',
    });
    expect(db.history).toHaveLength(0);
  });

  it('completed job + same clientMutationId twice → one insert, second duplicate', async () => {
    const db = baseDb('completed');
    const first = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cheque', amount: 15 },
      clientMutationId: 'mutation-dup-001',
    });
    const second = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cheque', amount: 15 },
      clientMutationId: 'mutation-dup-001',
    });
    expect(first).toMatchObject({
      success: true,
      alreadyCompleted: true,
      paymentDuplicate: false,
      paymentId: 'pay-1',
    });
    expect(second).toMatchObject({
      success: true,
      alreadyCompleted: true,
      paymentDuplicate: true,
      paymentId: 'pay-1',
    });
    expect(db.payments).toHaveLength(1);
  });

  it('completedAt 3 days ago is kept; 10 days ago and +1 hour become now', async () => {
    const keepDb = baseDb('assigned');
    const keep = await completeVisitCore(createFakeSupabase(keepDb), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      completedAt: '2026-09-12T16:55:00.000Z',
    });
    expect(keep.success).toBe(true);
    expect(keepDb.jobs[0]?.completed_at).toBe('2026-09-12T16:55:00.000Z');

    const oldDb = baseDb('assigned');
    await completeVisitCore(createFakeSupabase(oldDb), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      completedAt: '2026-09-01T12:00:00.000Z',
    });
    expect(oldDb.jobs[0]?.completed_at).toBe('2026-09-15T12:00:00.000Z');

    const futureDb = baseDb('assigned');
    await completeVisitCore(createFakeSupabase(futureDb), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      completedAt: '2026-09-15T13:00:00.000Z',
    });
    expect(futureDb.jobs[0]?.completed_at).toBe('2026-09-15T12:00:00.000Z');
  });

  it('Done that loses a race with another Done records the cash once and writes no history', async () => {
    const db = baseDb('completed');
    db.staleStatusOnce = 'assigned';
    const result = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cash', amount: 15 },
      clientMutationId: 'mutation-race-001',
    });
    expect(result).toMatchObject({ success: true, alreadyCompleted: true, paymentId: 'pay-1' });
    expect(db.payments).toHaveLength(1);
    expect(db.history).toHaveLength(0);
  });

  it('Done that loses a race with a Skip does not un-skip the visit; cash is kept as credit', async () => {
    const db = baseDb('cancelled');
    db.staleStatusOnce = 'assigned';
    const result = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cash', amount: 15 },
      clientMutationId: 'mutation-race-002',
    });
    expect(result).toMatchObject({ success: true, skippedElsewhere: true, paymentId: 'pay-1' });
    expect(db.jobs[0]?.status).toBe('cancelled');
    expect(db.payments).toHaveLength(1);
  });

  it("alreadyDonePayment 'ignore' (dashboard) records nothing on an already-done visit", async () => {
    const db = baseDb('completed');
    const result = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cash', amount: 15 },
      alreadyDonePayment: 'ignore',
    });
    expect(result).toMatchObject({ success: true, alreadyCompleted: true, paymentId: null });
    expect(db.payments).toHaveLength(0);
  });

  it('payment failing after Done is retryable for the phone, not for the dashboard', async () => {
    const phoneDb = baseDb('assigned');
    phoneDb.failPaymentInsert = true;
    const phone = await completeVisitCore(createFakeSupabase(phoneDb), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cash', amount: 15 },
      clientMutationId: 'mutation-fail-001',
    });
    expect(phone).toMatchObject({ success: false, retryable: true });
    expect(phoneDb.jobs[0]?.status).toBe('completed');

    // The retry lands on the already-done path and records the cash.
    phoneDb.failPaymentInsert = false;
    const retry = await completeVisitCore(createFakeSupabase(phoneDb), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cash', amount: 15 },
      clientMutationId: 'mutation-fail-001',
    });
    expect(retry).toMatchObject({ success: true, alreadyCompleted: true, paymentId: 'pay-1' });
    expect(phoneDb.payments).toHaveLength(1);

    const dashDb = baseDb('assigned');
    dashDb.failPaymentInsert = true;
    const dash = await completeVisitCore(createFakeSupabase(dashDb), {
      tenantId: TENANT,
      jobId: JOB,
      actor: ACTOR,
      payment: { method: 'cash', amount: 15 },
      alreadyDonePayment: 'ignore',
    });
    expect(dash).toMatchObject({ success: false, retryable: false });
  });
});

describe('skipVisitCore already-completed', () => {
  it('Skip that loses a race with Done leaves the visit done (Done beats Skip)', async () => {
    const db = baseDb('completed');
    db.staleStatusOnce = 'assigned';
    const result = await skipVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: JOB,
      reason: 'no_access',
      actor: ACTOR,
    });
    expect(result).toMatchObject({ success: false, code: 'already_completed' });
    expect(db.jobs[0]?.status).toBe('completed');
    expect(db.history).toHaveLength(0);
  });

  it('returns already_completed when the visit is done', async () => {
    const db = baseDb('completed');
    const result = await skipVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: JOB,
      reason: 'no_access',
      actor: ACTOR,
    });
    expect(result).toEqual({
      success: false,
      error: 'This visit is already done.',
      code: 'already_completed',
    });
  });
});
