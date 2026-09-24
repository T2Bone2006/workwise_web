import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ROUNDS_SETTINGS } from '@/lib/rounds/settings';
import { mapAgreementRow, type AgreementRow } from '@/lib/rounds/generate-visits';
import { optimiseDayCore } from '@/lib/rounds/optimise-day';
import { postcodeToLatLng } from '@/lib/utils/postcode';
import {
  completeVisitCore,
  deleteUntouchedFutureVisits,
  moveRemainingCore,
  reorderDayCore,
  repriceUntouchedFutureVisits,
  rescheduleVisitCore,
  skipVisitCore,
} from '@/lib/rounds/visit-transitions';

vi.mock('@/lib/utils/postcode', () => ({
  postcodeToLatLng: vi.fn(async () => ({ lat: 51.51, lng: -0.14 })),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const WORKER = '22222222-2222-2222-2222-222222222222';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const AGREEMENT = 'a1b2c3de-0000-4000-8000-000000000001';
const TODAY = '2026-09-15';
const ACTOR = { userId: 'user-1' };

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'in'; col: string; val: unknown[] }
  | { kind: 'gte'; col: string; val: unknown }
  | { kind: 'lte'; col: string; val: unknown }
  | { kind: 'not'; col: string; op: string; val: unknown };

type FakeDb = {
  settings: unknown;
  worker: Record<string, unknown> | null;
  catalog: Record<string, string>;
  agreements: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  history: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  nextJobId: number;
};

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  for (const filter of filters) {
    const value = row[filter.col];
    if (filter.kind === 'eq' && value !== filter.val) return false;
    if (filter.kind === 'in' && !filter.val.includes(value)) return false;
    if (filter.kind === 'gte' && String(value) < String(filter.val)) return false;
    if (filter.kind === 'lte' && String(value) > String(filter.val)) return false;
    if (filter.kind === 'not' && filter.op === 'is' && filter.val === null && value == null) {
      return false;
    }
  }
  return true;
}

function createFakeSupabase(db: FakeDb): SupabaseClient {
  const from = (table: string) => {
    let op: 'select' | 'upsert' | 'insert' | 'update' | 'delete' = 'select';
    let payload: unknown = null;
    let upsertOpts: { ignoreDuplicates?: boolean } = {};
    const filters: Filter[] = [];
    let countHead = false;

    const builder = {
      select(_columns?: string, opts?: { count?: string; head?: boolean }) {
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
      not(col: string, operator: string, val: unknown) {
        filters.push({ kind: 'not', col, op: operator, val });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(execute('maybeSingle'));
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute('await')).then(resolve, reject);
      },
    };

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
          const patch = payload as Record<string, unknown>;
          for (const row of db.jobs) {
            if (matches(row, filters)) Object.assign(row, patch);
          }
          return { data: null, error: null };
        }
        if (op === 'delete') {
          const remaining = db.jobs.filter((row) => !matches(row, filters));
          const removed = db.jobs.length - remaining.length;
          db.jobs.splice(0, db.jobs.length, ...remaining);
          return { data: null, error: null, count: removed };
        }
        if (op === 'select') {
          const rows = db.jobs.filter((row) => matches(row, filters));
          if (countHead) return { data: null, error: null, count: rows.length };
          if (mode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
          return { data: rows, error: null };
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
    nextJobId: 10,
    ...over,
  };
}

describe('completeVisitCore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses an already completed visit', async () => {
    const db = emptyDb({ jobs: [job({ status: 'completed' })] });
    const result = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: 'job-1',
      actor: ACTOR,
    });
    expect(result.success).toBe(false);
  });

  it('marks the visit done and does not generate for a fixed agreement', async () => {
    const db = emptyDb();
    const result = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: 'job-1',
      finalAmount: 15,
      notes: 'Paid cash',
      actor: ACTOR,
    });
    expect(result).toEqual({ success: true });
    expect(db.jobs[0]?.status).toBe('completed');
    expect(db.jobs[0]?.final_amount).toBe(15);
    expect(db.jobs[0]?.completion_notes).toBe('Paid cash');
    expect(db.jobs).toHaveLength(1);
    expect(db.history[0]).toMatchObject({
      from_status: 'assigned',
      to_status: 'completed',
    });
  });

  it('on after_completion, plans the next visit from the completed date', async () => {
    const agr = agreement({ schedule_mode: 'after_completion', frequency_days: 7 });
    const db = emptyDb({ agreements: [{ ...agr }] });
    const result = await completeVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: 'job-1',
      actor: ACTOR,
    });
    expect(result).toEqual({ success: true });
    expect(db.jobs.some((row) => row.agreement_occurrence_date === '2026-09-22')).toBe(true);
    expect(db.agreements[0]?.next_due_date).toBe('2026-09-29');
  });
});

describe('skipVisitCore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels the visit with a skip reason and clears route_position', async () => {
    const db = emptyDb();
    const result = await skipVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'no_access',
      note: 'Gate locked',
      actor: ACTOR,
    });
    expect(result).toEqual({ success: true });
    expect(db.jobs[0]?.status).toBe('cancelled');
    expect(db.jobs[0]?.skip_reason).toBe('no_access');
    expect(db.jobs[0]?.completion_notes).toBe('Gate locked');
    expect(db.jobs[0]?.route_position).toBeNull();
    expect(db.history[0]).toMatchObject({
      notes: 'Visit skipped',
      metadata: { skip_reason: 'no_access', note: 'Gate locked' },
    });
  });

  it('on after_completion, next visit is from the scheduled date, not today', async () => {
    const agr = agreement({ schedule_mode: 'after_completion', frequency_days: 7 });
    const db = emptyDb({
      agreements: [{ ...agr }],
      jobs: [job({ scheduled_date: TODAY })],
    });
    await skipVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: 'job-1',
      reason: 'weather',
      actor: ACTOR,
    });
    expect(db.jobs.some((row) => row.agreement_occurrence_date === '2026-09-22')).toBe(true);
    expect(db.agreements[0]?.next_due_date).toBe('2026-09-29');
  });
});

describe('rescheduleVisitCore / moveRemainingCore', () => {
  it('moves one stop and leaves the occurrence date alone', async () => {
    const db = emptyDb();
    const result = await rescheduleVisitCore(createFakeSupabase(db), {
      tenantId: TENANT,
      jobId: 'job-1',
      scheduledDate: '2026-09-18',
      actor: ACTOR,
    });
    expect(result).toEqual({ success: true });
    expect(db.jobs[0]?.scheduled_date).toBe('2026-09-18');
    expect(db.jobs[0]?.agreement_occurrence_date).toBe(TODAY);
    expect(db.jobs[0]?.route_position).toBeNull();
    expect(db.history[0]?.notes).toBe(`Rescheduled from ${TODAY} to 2026-09-18`);
  });

  it('move remaining only moves leftover stops, and is a no-op on the same day', async () => {
    const db = emptyDb({
      jobs: [
        job({ id: 'done', status: 'completed' }),
        job({ id: 'skipped', status: 'cancelled' }),
        job({ id: 'left', status: 'assigned' }),
        job({ id: 'going', status: 'en_route' }),
      ],
    });
    const same = await moveRemainingCore(createFakeSupabase(db), {
      tenantId: TENANT,
      fromDate: TODAY,
      toDate: TODAY,
      actor: ACTOR,
    });
    expect(same).toEqual({ success: true, moved: 0 });

    const moved = await moveRemainingCore(createFakeSupabase(db), {
      tenantId: TENANT,
      fromDate: TODAY,
      toDate: '2026-09-18',
      actor: ACTOR,
    });
    expect(moved).toEqual({ success: true, moved: 2 });
    expect(db.jobs.find((row) => row.id === 'done')?.scheduled_date).toBe(TODAY);
    expect(db.jobs.find((row) => row.id === 'skipped')?.scheduled_date).toBe(TODAY);
    expect(db.jobs.find((row) => row.id === 'left')?.scheduled_date).toBe('2026-09-18');
    expect(db.jobs.find((row) => row.id === 'going')?.scheduled_date).toBe('2026-09-18');
    expect(db.history.some((row) => String(row.notes).startsWith('Moved remaining'))).toBe(true);
  });
});

describe('reorderDayCore / delete / reprice', () => {
  it('writes route_position 1..n when every id is on that day', async () => {
    const db = emptyDb({
      jobs: [job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })],
    });
    const result = await reorderDayCore(createFakeSupabase(db), {
      tenantId: TENANT,
      date: TODAY,
      orderedJobIds: ['c', 'a', 'b'],
    });
    expect(result).toEqual({ success: true });
    expect(db.jobs.find((row) => row.id === 'c')?.route_position).toBe(1);
    expect(db.jobs.find((row) => row.id === 'a')?.route_position).toBe(2);
    expect(db.jobs.find((row) => row.id === 'b')?.route_position).toBe(3);
  });

  it('rejects an id that is not on that day', async () => {
    const db = emptyDb({
      jobs: [job({ id: 'a' }), job({ id: 'other-day', scheduled_date: '2026-09-18' })],
    });
    const result = await reorderDayCore(createFakeSupabase(db), {
      tenantId: TENANT,
      date: TODAY,
      orderedJobIds: ['a', 'other-day'],
    });
    expect(result.success).toBe(false);
  });

  it('deletes only assigned future visits, after history rows', async () => {
    const db = emptyDb({
      jobs: [
        job({ id: 'keep-done', status: 'completed', scheduled_date: '2026-09-20' }),
        job({ id: 'drop', status: 'assigned', scheduled_date: '2026-09-20' }),
        job({ id: 'too-soon', status: 'assigned', scheduled_date: '2026-09-10' }),
      ],
      history: [{ job_id: 'drop', notes: 'old' }],
    });
    const count = await deleteUntouchedFutureVisits(createFakeSupabase(db), {
      tenantId: TENANT,
      agreementId: AGREEMENT,
      fromDate: TODAY,
    });
    expect(count).toBe(1);
    expect(db.jobs.map((row) => row.id).sort()).toEqual(['keep-done', 'too-soon']);
    expect(db.history).toHaveLength(0);
  });

  it('reprices only assigned future visits', async () => {
    const db = emptyDb({
      jobs: [
        job({ id: 'future', quoted_amount: 15, scheduled_date: '2026-09-20' }),
        job({ id: 'done', status: 'completed', quoted_amount: 15, scheduled_date: '2026-09-20' }),
      ],
    });
    const count = await repriceUntouchedFutureVisits(createFakeSupabase(db), {
      tenantId: TENANT,
      agreementId: AGREEMENT,
      fromDate: TODAY,
      price: 18,
    });
    expect(count).toBe(1);
    expect(db.jobs.find((row) => row.id === 'future')?.quoted_amount).toBe(18);
    expect(db.jobs.find((row) => row.id === 'done')?.quoted_amount).toBe(15);
  });
});

describe('optimiseDayCore', () => {
  it('orders stops and can persist route_position', async () => {
    const db = emptyDb({
      jobs: [
        job({ id: 'far', lat: 51.6, lng: -0.2, address: 'Far' }),
        job({ id: 'near', lat: 51.501, lng: -0.121, address: 'Near' }),
        job({ id: 'ghost', lat: null, lng: null, address: 'No pin' }),
      ],
    });
    const result = await optimiseDayCore(createFakeSupabase(db), {
      tenantId: TENANT,
      date: TODAY,
      persist: true,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.start).toEqual({ lat: 51.5, lng: -0.12 });
    expect(result.finish).toEqual({ lat: 51.5, lng: -0.12 });
    expect(result.stops.map((stop) => stop.jobId)).toHaveLength(3);
    expect(result.stops[result.stops.length - 1]?.jobId).toBe('ghost');
    expect(result.stops.map((stop) => stop.jobId).sort()).toEqual(['far', 'ghost', 'near']);
    expect(db.jobs.find((row) => row.id === result.stops[0]?.jobId)?.route_position).toBe(1);
  });

  it('uses a finish override for this run and leaves home as the start', async () => {
    vi.mocked(postcodeToLatLng).mockImplementation(async (postcode: string) => {
      if (postcode.startsWith('E1')) return { lat: 51.7, lng: -0.05 };
      return null;
    });
    try {
      const db = emptyDb({
        jobs: [
          job({ id: 'far', lat: 51.6, lng: -0.2, address: 'Far' }),
          job({ id: 'near', lat: 51.501, lng: -0.121, address: 'Near' }),
        ],
      });
      const result = await optimiseDayCore(createFakeSupabase(db), {
        tenantId: TENANT,
        date: TODAY,
        persist: false,
        finishPostcode: 'E1 6AN',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.start).toEqual({ lat: 51.5, lng: -0.12 });
      expect(result.finish).toEqual({ lat: 51.7, lng: -0.05 });
      expect(db.settings).toEqual({ rounds: DEFAULT_ROUNDS_SETTINGS });
    } finally {
      vi.mocked(postcodeToLatLng).mockImplementation(async () => ({ lat: 51.51, lng: -0.14 }));
    }
  });
});

describe('mapAgreementRow still used after complete cursor write', () => {
  it('reads the updated agreement', () => {
    const mapped = mapAgreementRow({
      ...agreement({ next_due_date: '2026-09-22' }),
    } as unknown as Record<string, unknown>);
    expect(mapped?.next_due_date).toBe('2026-09-22');
  });
});
