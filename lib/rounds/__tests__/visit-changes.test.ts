import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ROUNDS_SETTINGS } from '@/lib/rounds/settings';
import type { AgreementRow } from '@/lib/rounds/generate-visits';
import { SKIP_REASON_LABELS, USER_SKIP_REASONS } from '@/lib/rounds/skip-reasons';
import {
  getVisitChange,
  latestUndoableChange,
  moveRemainingWithLog,
  rescheduleStopWithLog,
  skipRemainingCore,
  skipStopWithLog,
  skipVisitWithLog,
  undoVisitChangeCore,
} from '@/lib/rounds/visit-changes';

const TENANT = '11111111-1111-1111-1111-111111111111';
const WORKER = '22222222-2222-2222-2222-222222222222';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const AGREEMENT = 'a1b2c3de-0000-4000-8000-000000000001';
const TODAY = '2026-09-15';
const ACTOR = { userId: 'user-1' };
const DAY_MS = 86_400_000;

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'in'; col: string; val: unknown[] }
  | { kind: 'gte'; col: string; val: unknown }
  | { kind: 'lte'; col: string; val: unknown }
  | { kind: 'is'; col: string; val: unknown }
  | { kind: 'not'; col: string; op: string; val: unknown };

type FakeDb = {
  settings: unknown;
  worker: Record<string, unknown> | null;
  catalog: Record<string, string>;
  agreements: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  history: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  changes: Record<string, unknown>[];
  nextJobId: number;
  nextChangeId: number;
  failJobRead?: boolean;
  failChangeInsert?: boolean;
  /** Succeed this many jobs updates, then fail the next one. */
  failJobUpdateAfter?: number;
  failAgreementCursorOnce?: boolean;
  mutateAfterRead?: { jobId: string; patch: Record<string, unknown> };
};

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  for (const filter of filters) {
    const value = row[filter.col];
    if (filter.kind === 'eq' && value !== filter.val) return false;
    if (filter.kind === 'in' && !filter.val.includes(value)) return false;
    if (filter.kind === 'gte' && String(value) < String(filter.val)) return false;
    if (filter.kind === 'lte' && String(value) > String(filter.val)) return false;
    if (filter.kind === 'is' && value !== filter.val) return false;
    if (filter.kind === 'not' && filter.op === 'is' && filter.val === null && value == null) {
      return false;
    }
    if (filter.kind === 'not' && filter.op === 'in') {
      const list = String(filter.val).replace(/^\(|\)$/g, '').split(',');
      if (list.includes(String(value))) return false;
    }
  }
  return true;
}

function matchesOr(row: Record<string, unknown>, expr: string | null): boolean {
  if (!expr) return true;
  return expr.split(',').some((part) => {
    const match = /^([a-z_]+)\.eq\.(.*)$/.exec(part);
    if (!match) return false;
    const col = match[1];
    if (!col) return false;
    return String(row[col] ?? '') === match[2];
  });
}

function createFakeSupabase(db: FakeDb): SupabaseClient {
  const from = (table: string) => {
    let op: 'select' | 'upsert' | 'insert' | 'update' | 'delete' = 'select';
    let payload: unknown = null;
    let upsertOpts: { ignoreDuplicates?: boolean } = {};
    let selected = '';
    let orExpr: string | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;
    const filters: Filter[] = [];
    let countHead = false;

    const builder = {
      select(columns?: string, opts?: { count?: string; head?: boolean }) {
        if (typeof columns === 'string') selected = columns;
        if (opts?.count === 'exact' && opts.head) countHead = true;
        return builder;
      },
      upsert(rows: unknown, opts?: { ignoreDuplicates?: boolean }) {
        op = 'upsert';
        payload = rows;
        upsertOpts = opts ?? {};
        return builder;
      },
      insert(rows: unknown) {
        op = 'insert';
        payload = rows;
        return builder;
      },
      update(row: unknown) {
        op = 'update';
        payload = row;
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ kind: 'eq', col, val });
        return builder;
      },
      in(col: string, val: unknown[]) {
        filters.push({ kind: 'in', col, val });
        return builder;
      },
      gte(col: string, val: unknown) {
        filters.push({ kind: 'gte', col, val });
        return builder;
      },
      lte(col: string, val: unknown) {
        filters.push({ kind: 'lte', col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push({ kind: 'is', col, val });
        return builder;
      },
      or(expr: string) {
        orExpr = expr;
        return builder;
      },
      not(col: string, operator: string, val: unknown) {
        filters.push({ kind: 'not', col, op: operator, val });
        return builder;
      },
      order(col?: string, opts?: { ascending?: boolean }) {
        if (typeof col === 'string') {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
        }
        return builder;
      },
      limit(n?: number) {
        if (typeof n === 'number') limitN = n;
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(execute('maybeSingle'));
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute('await')).then(resolve, reject);
      },
    };

    function shapeJobs(rows: Record<string, unknown>[]): Record<string, unknown>[] {
      if (!selected.includes('service_agreements')) return rows;
      return rows.map((row) => {
        const agr = db.agreements.find((item) => item.id === row.service_agreement_id);
        return {
          ...row,
          service_agreements: agr
            ? { schedule_mode: agr.schedule_mode, next_due_date: agr.next_due_date }
            : null,
        };
      });
    }

    function sortLimit(rows: Record<string, unknown>[]): Record<string, unknown>[] {
      let next = rows;
      if (orderCol) {
        const col = orderCol;
        next = [...next].sort((a, b) => {
          const av = String(a[col] ?? '');
          const bv = String(b[col] ?? '');
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return orderAsc ? cmp : -cmp;
        });
      }
      if (limitN != null) next = next.slice(0, limitN);
      return next;
    }

    function execute(mode: 'await' | 'maybeSingle') {
      if (table === 'tenants' && op === 'select') {
        const data = { settings: db.settings };
        return mode === 'maybeSingle' ? { data, error: null } : { data: [data], error: null };
      }
      if (table === 'workers' && op === 'select') {
        return { data: db.worker, error: null };
      }
      if (table === 'service_catalog' && op === 'select') {
        const idFilter = filters.find((f) => f.kind === 'eq' && f.col === 'id');
        const id = idFilter && idFilter.kind === 'eq' ? String(idFilter.val) : '';
        const name = db.catalog[id];
        return { data: name ? { name } : null, error: null };
      }
      if (table === 'service_agreements') {
        if (op === 'select') {
          const rows = db.agreements.filter((row) => matches(row, filters));
          return mode === 'maybeSingle'
            ? { data: rows[0] ?? null, error: null }
            : { data: rows, error: null };
        }
        if (op === 'update') {
          if (db.failAgreementCursorOnce) {
            db.failAgreementCursorOnce = false;
            return { data: null, error: { message: 'could not save next date' } };
          }
          const patch = payload as Record<string, unknown>;
          for (const row of db.agreements) {
            if (matches(row, filters)) Object.assign(row, patch);
          }
          return { data: null, error: null };
        }
      }
      if (table === 'jobs') {
        if (op === 'upsert') {
          const rows = (payload as Record<string, unknown>[]) ?? [];
          const inserted: { id: string }[] = [];
          for (const row of rows) {
            const dup = db.jobs.find(
              (job) =>
                job.service_agreement_id === row.service_agreement_id &&
                job.agreement_occurrence_date === row.agreement_occurrence_date,
            );
            if (dup) {
              if (!upsertOpts.ignoreDuplicates) Object.assign(dup, row);
              continue;
            }
            const id = `job-${db.nextJobId++}`;
            db.jobs.push({ ...row, id });
            inserted.push({ id });
          }
          return { data: inserted, error: null };
        }
        if (op === 'update') {
          if (typeof db.failJobUpdateAfter === 'number') {
            if (db.failJobUpdateAfter <= 0) {
              db.failJobUpdateAfter = undefined;
              return { data: null, error: { message: 'could not move stop' } };
            }
            db.failJobUpdateAfter -= 1;
          }
          const patch = payload as Record<string, unknown>;
          const updated: { id: unknown }[] = [];
          for (const row of db.jobs) {
            if (matches(row, filters)) {
              Object.assign(row, patch);
              updated.push({ id: row.id });
            }
          }
          return { data: updated, error: null };
        }
        if (op === 'delete') {
          const remaining = db.jobs.filter((row) => !matches(row, filters));
          const removed = db.jobs.length - remaining.length;
          db.jobs.splice(0, db.jobs.length, ...remaining);
          return { data: null, error: null, count: removed };
        }
        if (op === 'select') {
          if (mode === 'maybeSingle' && db.failJobRead) {
            return { data: null, error: { message: 'could not read job' } };
          }
          const rows = db.jobs.filter((row) => matches(row, filters));
          if (countHead) return { data: null, error: null, count: rows.length };
          const shaped = shapeJobs(rows);
          if (mode === 'maybeSingle') {
            const row = shaped[0] ?? null;
            const pending = db.mutateAfterRead;
            if (row && pending && pending.jobId === row.id) {
              const stored = db.jobs.find((item) => item.id === row.id);
              const seen = stored ? { ...stored } : { ...row };
              if (stored) Object.assign(stored, pending.patch);
              db.mutateAfterRead = undefined;
              return { data: seen, error: null };
            }
            return { data: row, error: null };
          }
          return { data: shaped, error: null };
        }
      }
      if (table === 'job_status_history') {
        if (op === 'insert') {
          const rows = Array.isArray(payload) ? payload : [payload];
          db.history.push(...(rows as Record<string, unknown>[]));
          return { data: rows, error: null };
        }
        if (op === 'delete') {
          const remaining = db.history.filter((row) => {
            const jobId = row.job_id;
            const inFilter = filters.find((f) => f.kind === 'in' && f.col === 'job_id');
            if (inFilter && inFilter.kind === 'in') return !inFilter.val.includes(jobId);
            return true;
          });
          db.history.splice(0, db.history.length, ...remaining);
          return { data: null, error: null };
        }
      }
      if (table === 'job_attachments' && op === 'delete') {
        return { data: null, error: null };
      }
      if (table === 'visit_changes') {
        if (op === 'insert') {
          if (db.failChangeInsert) return { data: null, error: { message: 'insert failed' } };
          const source = (payload ?? {}) as Record<string, unknown>;
          const row: Record<string, unknown> = { ...source };
          if (typeof row.id !== 'string') row.id = `change-${db.nextChangeId++}`;
          if (typeof row.created_at !== 'string') row.created_at = new Date().toISOString();
          if (!('undone_at' in row)) row.undone_at = null;
          if (!('notified_at' in row)) row.notified_at = null;
          if (Array.isArray(row.before)) row.before = [...row.before];
          if (Array.isArray(row.job_ids)) row.job_ids = [...row.job_ids];
          db.changes.push(row);
          return mode === 'maybeSingle' ? { data: row, error: null } : { data: [row], error: null };
        }
        if (op === 'update') {
          const patch = payload as Record<string, unknown>;
          const updated: { id: unknown }[] = [];
          for (const row of db.changes) {
            if (matches(row, filters) && matchesOr(row, orExpr)) {
              Object.assign(row, patch);
              updated.push({ id: row.id });
            }
          }
          return { data: updated, error: null };
        }
        if (op === 'select') {
          const rows = sortLimit(
            db.changes.filter((row) => matches(row, filters) && matchesOr(row, orExpr)),
          );
          if (mode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
          return { data: rows, error: null };
        }
      }
      return { data: mode === 'maybeSingle' ? null : [], error: null };
    }

    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

function agreement(over: Partial<AgreementRow> = {}): AgreementRow {
  return {
    id: AGREEMENT,
    tenant_id: TENANT,
    customer_id: CUSTOMER,
    service_catalog_id: null,
    title: 'Window clean',
    address: '12 Elm Road',
    postcode: 'SW1A 1AA',
    lat: 51.5,
    lng: -0.1,
    price: 15,
    duration_minutes: 30,
    frequency_days: 7,
    anchor_date: TODAY,
    preferred_weekday: null,
    preferred_time: null,
    schedule_mode: 'fixed',
    next_due_date: TODAY,
    last_generated_at: null,
    status: 'active',
    paused_until: null,
    ended_at: null,
    assigned_worker_id: null,
    default_payment_method: null,
    reminder_enabled: true,
    access_notes: null,
    notes: null,
    created_at: null,
    updated_at: null,
    ...over,
  };
}

function job(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    tenant_id: TENANT,
    customer_id: CUSTOMER,
    service_agreement_id: AGREEMENT,
    agreement_occurrence_date: TODAY,
    scheduled_date: TODAY,
    scheduled_time: null,
    status: 'assigned',
    route_position: 1,
    quoted_amount: 15,
    address: '12 Elm Road',
    postcode: 'SW1A 1AA',
    lat: 51.5,
    lng: -0.1,
    skip_reason: null,
    completion_notes: null,
    completed_at: null,
    final_amount: null,
    customer_confirmation_status: null,
    customer_requested_date: null,
    customer_reply_at: null,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

function emptyDb(over: Partial<FakeDb> = {}): FakeDb {
  const agr = agreement();
  return {
    settings: { rounds: DEFAULT_ROUNDS_SETTINGS },
    worker: {
      id: WORKER,
      full_name: 'Pat',
      home_postcode: 'SW1A 1AA',
      home_lat: 51.5,
      home_lng: -0.12,
      expo_push_token: null,
    },
    catalog: {},
    agreements: [{ ...agr }],
    jobs: [job()],
    history: [],
    attachments: [],
    changes: [],
    nextJobId: 10,
    nextChangeId: 1,
    ...over,
  };
}

function changeIdOf(result: { success: boolean; changeId?: string | null }): string {
  if (!result.success || result.changeId == null) {
    throw new Error('expected a change id');
  }
  return result.changeId;
}

describe('visit changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records one change for move remaining and undo puts every stop back', async () => {
    const db = emptyDb({
      jobs: [
        job({ id: 'a', route_position: 1 }),
        job({ id: 'b', route_position: 2 }),
        job({ id: 'c', route_position: 3 }),
      ],
    });
    const supabase = createFakeSupabase(db);
    const moved = await moveRemainingWithLog(supabase, {
      tenantId: TENANT,
      fromDate: TODAY,
      toDate: '2026-09-18',
      actor: ACTOR,
      notifyCustomers: true,
    });
    expect(moved).toEqual({ success: true, moved: 3, changeId: 'change-1' });
    expect(db.changes).toHaveLength(1);
    expect(db.changes[0]?.kind).toBe('move_remaining');
    expect(db.changes[0]?.job_ids).toEqual(['a', 'b', 'c']);
    expect(db.changes[0]?.from_date).toBe(TODAY);
    expect(db.changes[0]?.to_date).toBe('2026-09-18');
    expect(db.changes[0]?.notify_customers).toBe(true);
    const before = db.changes[0]?.before as { job_id: string; route_position: number }[];
    expect(before).toHaveLength(3);
    expect(before.map((row) => row.job_id)).toEqual(['a', 'b', 'c']);
    expect(before[0]?.route_position).toBe(1);

    const stored = await getVisitChange(supabase, TENANT, 'change-1');
    expect(stored?.jobCount).toBe(3);
    expect(stored?.before[0]?.agreement_schedule_mode).toBe('fixed');
    expect(await latestUndoableChange(supabase, TENANT, { date: TODAY })).toMatchObject({
      id: 'change-1',
    });
    expect(await latestUndoableChange(supabase, TENANT, { date: '2026-09-18' })).toMatchObject({
      id: 'change-1',
    });
    expect(await latestUndoableChange(supabase, TENANT, { date: '2026-01-01' })).toBeNull();

    const undone = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: 'change-1',
      actor: ACTOR,
    });
    expect(undone).toMatchObject({
      success: true,
      restored: 3,
      leftAlone: 0,
      restoredJobIds: ['a', 'b', 'c'],
    });
    for (const id of ['a', 'b', 'c']) {
      const row = db.jobs.find((item) => item.id === id);
      expect(row?.scheduled_date).toBe(TODAY);
      expect(row?.route_position).toBeNull();
    }
    expect(db.changes).toHaveLength(1);
    expect(db.changes[0]?.undone_at).toBe('2026-09-15T12:00:00.000Z');
    expect(db.changes[0]?.undone_by_user_id).toBe('user-1');
    expect(db.history.filter((row) => row.notes === 'Move undone')).toHaveLength(3);
    expect(db.history.find((row) => row.notes === 'Move undone')?.metadata).toEqual({
      from: '2026-09-18',
      to: TODAY,
    });
    expect(await latestUndoableChange(supabase, TENANT)).toBeNull();
  });

  it('leaves a stop alone when it was marked done after the move', async () => {
    const db = emptyDb({
      jobs: [
        job({ id: 'a', route_position: 1 }),
        job({ id: 'b', route_position: 2 }),
        job({ id: 'c', route_position: 3 }),
      ],
    });
    const supabase = createFakeSupabase(db);
    const moved = await moveRemainingWithLog(supabase, {
      tenantId: TENANT,
      fromDate: TODAY,
      toDate: '2026-09-18',
      actor: ACTOR,
    });
    const changeId = changeIdOf(moved);
    const done = db.jobs.find((row) => row.id === 'b');
    if (done) done.status = 'completed';

    const undone = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId,
      actor: ACTOR,
    });
    expect(undone).toMatchObject({ success: true, restored: 2, leftAlone: 1 });
    expect(db.jobs.find((row) => row.id === 'a')?.scheduled_date).toBe(TODAY);
    expect(db.jobs.find((row) => row.id === 'c')?.scheduled_date).toBe(TODAY);
    expect(db.jobs.find((row) => row.id === 'b')?.scheduled_date).toBe('2026-09-18');
    expect(db.jobs.find((row) => row.id === 'b')?.status).toBe('completed');
  });

  it('skip remaining skips only open stops, and undo puts them back', async () => {
    expect(USER_SKIP_REASONS).not.toContain('trader_unavailable');
    expect(SKIP_REASON_LABELS.trader_unavailable).toBe("Couldn't make it");

    const db = emptyDb({
      jobs: [
        job({ id: 'open-1', status: 'assigned' }),
        job({ id: 'open-2', status: 'assigned' }),
        job({ id: 'done', status: 'completed' }),
      ],
    });
    const supabase = createFakeSupabase(db);
    const skipped = await skipRemainingCore(supabase, {
      tenantId: TENANT,
      date: TODAY,
      actor: ACTOR,
    });
    expect(skipped).toEqual({ success: true, skipped: 2, changeId: 'change-1' });
    expect(db.changes).toHaveLength(1);
    expect(db.changes[0]?.kind).toBe('skip_remaining');
    expect(db.changes[0]?.job_ids).toEqual(['open-1', 'open-2']);
    expect(db.jobs.find((row) => row.id === 'open-1')).toMatchObject({
      status: 'cancelled',
      skip_reason: 'trader_unavailable',
    });
    expect(db.jobs.find((row) => row.id === 'open-2')?.skip_reason).toBe('trader_unavailable');
    expect(db.jobs.find((row) => row.id === 'done')?.status).toBe('completed');

    const undone = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: 'change-1',
      actor: ACTOR,
    });
    expect(undone).toMatchObject({
      success: true,
      restored: 2,
      leftAlone: 0,
      restoredJobIds: ['open-1', 'open-2'],
    });
    for (const id of ['open-1', 'open-2']) {
      expect(db.jobs.find((row) => row.id === id)).toMatchObject({
        status: 'assigned',
        skip_reason: null,
        scheduled_date: TODAY,
      });
    }
    expect(db.history.filter((row) => row.notes === 'Skip undone')).toHaveLength(2);
  });

  it('retries an after_completion undo when the cursor update fails once', async () => {
    const agr = agreement({ schedule_mode: 'after_completion', frequency_days: 7 });
    const db = emptyDb({
      agreements: [{ ...agr }],
      jobs: [job({ scheduled_date: TODAY })],
    });
    const supabase = createFakeSupabase(db);
    const skipped = await skipVisitWithLog(supabase, {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'weather',
      actor: ACTOR,
    });
    expect(skipped).toMatchObject({ success: true, changeId: 'change-1' });
    expect(db.jobs.filter((row) => row.status === 'assigned')).toHaveLength(1);
    expect(db.agreements[0]?.next_due_date).toBe('2026-09-29');

    db.failAgreementCursorOnce = true;
    const failed = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: 'change-1',
      actor: ACTOR,
    });
    expect(failed).toEqual({ success: false, error: 'Could not undo this change. Try again.' });
    expect(db.jobs.find((row) => row.id === 'job-1')?.status).toBe('cancelled');
    expect(db.changes[0]?.undone_at).toBeNull();

    const undone = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: 'change-1',
      actor: ACTOR,
    });
    expect(undone).toMatchObject({ success: true, restored: 1, leftAlone: 0 });
    expect(db.jobs.filter((row) => row.status === 'assigned')).toEqual([
      expect.objectContaining({ id: 'job-1', scheduled_date: TODAY }),
    ]);
    expect(db.agreements[0]?.next_due_date).toBe(TODAY);
  });

  it('undo of an after_completion skip deletes the generated visit and restores the cursor', async () => {
    const agr = agreement({ schedule_mode: 'after_completion', frequency_days: 7 });
    const db = emptyDb({
      agreements: [{ ...agr }],
      jobs: [job({ scheduled_date: TODAY })],
    });
    const supabase = createFakeSupabase(db);
    const skipped = await skipVisitWithLog(supabase, {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'weather',
      actor: ACTOR,
    });
    expect(skipped).toMatchObject({ success: true, alreadySkipped: false, changeId: 'change-1' });
    expect(db.jobs.some((row) => row.agreement_occurrence_date === '2026-09-22')).toBe(true);
    expect(db.agreements[0]?.next_due_date).toBe('2026-09-29');
    const stored = await getVisitChange(supabase, TENANT, 'change-1');
    expect(stored?.before[0]).toMatchObject({
      agreement_schedule_mode: 'after_completion',
      agreement_next_due_date: TODAY,
    });

    const undone = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: 'change-1',
      actor: ACTOR,
    });
    expect(undone).toMatchObject({ success: true, restored: 1, leftAlone: 0 });
    expect(db.jobs.map((row) => row.id)).toEqual(['job-1']);
    expect(db.jobs[0]).toMatchObject({
      status: 'assigned',
      skip_reason: null,
      scheduled_date: TODAY,
    });
    expect(db.agreements[0]?.next_due_date).toBe(TODAY);
    expect(db.history.some((row) => row.notes === 'Skip undone')).toBe(true);
  });

  it('refuses a second undo and a change older than 14 days', async () => {
    const db = emptyDb();
    const supabase = createFakeSupabase(db);
    const first = await skipVisitWithLog(supabase, {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'no_access',
      actor: ACTOR,
    });
    const firstId = changeIdOf(first);
    const undone = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: firstId,
      actor: ACTOR,
    });
    expect(undone).toMatchObject({ success: true, restored: 1 });
    const again = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: firstId,
      actor: ACTOR,
    });
    expect(again).toEqual({ success: false, error: 'Already undone' });

    const second = await skipVisitWithLog(supabase, {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'weather',
      actor: ACTOR,
    });
    const secondId = changeIdOf(second);
    const tooOld = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: secondId,
      actor: ACTOR,
      now: new Date(Date.parse('2026-09-15T12:00:00.000Z') + 15 * DAY_MS),
    });
    expect(tooOld).toEqual({ success: false, error: 'Too old to undo' });
    expect(db.changes.find((row) => row.id === secondId)?.undone_at).toBeNull();
    expect(db.jobs[0]?.status).toBe('cancelled');
  });

  it('does not record a change when nothing is left to move', async () => {
    const db = emptyDb({
      jobs: [job({ id: 'done', status: 'completed' })],
    });
    const supabase = createFakeSupabase(db);
    const moved = await moveRemainingWithLog(supabase, {
      tenantId: TENANT,
      fromDate: TODAY,
      toDate: '2026-09-18',
      actor: ACTOR,
    });
    expect(moved).toEqual({ success: true, moved: 0, changeId: null });
    expect(db.changes).toHaveLength(0);
    expect(db.jobs[0]?.scheduled_date).toBe(TODAY);
  });

  it('records the stops already moved when move remaining fails part-way', async () => {
    const db = emptyDb({
      jobs: [job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })],
      failJobUpdateAfter: 1,
    });
    const supabase = createFakeSupabase(db);
    const moved = await moveRemainingWithLog(supabase, {
      tenantId: TENANT,
      fromDate: TODAY,
      toDate: '2026-09-18',
      actor: ACTOR,
    });
    expect(moved).toEqual({ success: false, error: 'could not move stop' });
    expect(db.jobs.find((row) => row.id === 'a')?.scheduled_date).toBe('2026-09-18');
    expect(db.jobs.find((row) => row.id === 'b')?.scheduled_date).toBe(TODAY);
    expect(db.jobs.find((row) => row.id === 'c')?.scheduled_date).toBe(TODAY);
    expect(db.changes).toHaveLength(1);
    expect(db.changes[0]).toMatchObject({
      kind: 'move_remaining',
      job_ids: ['a'],
      from_date: TODAY,
      to_date: '2026-09-18',
    });
  });

  it('does not record a change when the visit was already skipped', async () => {
    const db = emptyDb({
      jobs: [job({ status: 'cancelled', skip_reason: 'weather' })],
    });
    const supabase = createFakeSupabase(db);
    const skipped = await skipVisitWithLog(supabase, {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'no_access',
      actor: ACTOR,
    });
    expect(skipped).toEqual({ success: true, alreadySkipped: true, changeId: null });
    expect(db.changes).toHaveLength(0);
    expect(db.jobs[0]?.skip_reason).toBe('weather');
  });

  it('keeps the change undoable when a visit cannot be read, and leaves a visit that was finished first', async () => {
    const db = emptyDb();
    const supabase = createFakeSupabase(db);
    const skipped = await skipVisitWithLog(supabase, {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'weather',
      actor: ACTOR,
    });
    const changeId = changeIdOf(skipped);

    db.failJobRead = true;
    const failed = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId,
      actor: ACTOR,
    });
    expect(failed).toEqual({ success: false, error: 'Could not undo this change. Try again.' });
    expect(db.changes[0]?.undone_at).toBeNull();
    expect(db.jobs[0]?.status).toBe('cancelled');

    db.failJobRead = false;
    db.mutateAfterRead = { jobId: 'job-1', patch: { status: 'completed' } };
    const raced = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId,
      actor: ACTOR,
    });
    expect(raced).toMatchObject({ success: true, restored: 0, leftAlone: 1 });
    expect(db.jobs[0]?.status).toBe('completed');
    expect(db.changes[0]?.undone_at).toBeTruthy();
  });

  it('still skips the visit when the change log insert fails', async () => {
    const db = emptyDb({ failChangeInsert: true });
    const supabase = createFakeSupabase(db);
    const skipped = await skipVisitWithLog(supabase, {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'no_access',
      actor: ACTOR,
    });
    expect(skipped).toEqual({ success: true, alreadySkipped: false, changeId: null });
    expect(db.jobs[0]?.status).toBe('cancelled');
    expect(db.changes).toHaveLength(0);
  });

  it('clears reply labels on changed jobs and restores them when a skip is undone', async () => {
    const labelled = {
      customer_confirmation_status: 'declined',
      customer_requested_date: '2026-09-20',
      customer_reply_at: '2026-09-14T10:00:00.000Z',
    };
    const db = emptyDb({
      jobs: [
        job({ id: 'house-a', ...labelled }),
        job({ id: 'house-b', ...labelled, service_agreement_id: null }),
        job({ id: 'later', ...labelled }),
      ],
    });
    const supabase = createFakeSupabase(db);

    const skipped = await skipStopWithLog(supabase, {
      tenantId: TENANT,
      jobIds: ['house-a', 'house-b'],
      reason: 'customer_away',
      actor: ACTOR,
    });
    expect(skipped).toEqual({ success: true, skipped: 2, changeId: 'change-1' });
    expect(db.changes).toHaveLength(1);
    for (const id of ['house-a', 'house-b']) {
      expect(db.jobs.find((row) => row.id === id)).toMatchObject({
        status: 'cancelled',
        customer_confirmation_status: null,
        customer_requested_date: null,
        customer_reply_at: null,
      });
    }
    expect(db.jobs.find((row) => row.id === 'later')?.customer_confirmation_status).toBe('declined');

    const moved = await rescheduleStopWithLog(supabase, {
      tenantId: TENANT,
      jobIds: ['later'],
      scheduledDate: '2026-09-18',
      actor: ACTOR,
    });
    expect(moved).toMatchObject({ success: true, moved: 1 });
    expect(db.jobs.find((row) => row.id === 'later')).toMatchObject({
      scheduled_date: '2026-09-18',
      customer_confirmation_status: null,
      customer_requested_date: null,
      customer_reply_at: null,
    });

    const moveUndone = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: changeIdOf(moved),
      actor: ACTOR,
    });
    expect(moveUndone).toMatchObject({ success: true, restored: 1, leftAlone: 0 });
    expect(db.jobs.find((row) => row.id === 'later')).toMatchObject({
      scheduled_date: TODAY,
      customer_confirmation_status: 'declined',
      customer_requested_date: '2026-09-20',
      customer_reply_at: null,
    });

    const undone = await undoVisitChangeCore(supabase, {
      tenantId: TENANT,
      changeId: 'change-1',
      actor: ACTOR,
    });
    expect(undone).toMatchObject({ success: true, restored: 2 });
    for (const id of ['house-a', 'house-b']) {
      expect(db.jobs.find((row) => row.id === id)).toMatchObject({
        status: 'assigned',
        customer_confirmation_status: 'declined',
        customer_requested_date: '2026-09-20',
        customer_reply_at: null,
      });
    }
  });
});
