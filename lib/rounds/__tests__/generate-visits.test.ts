import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { DEFAULT_ROUNDS_SETTINGS } from '@/lib/rounds/settings';
import { horizonEnd, nextDueAfter } from '@/lib/rounds/recurrence';
import { generateVisitsForAgreement, generateVisitsForTenant, mapAgreementRow, type AgreementRow } from '@/lib/rounds/generate-visits';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';

const TENANT = '11111111-1111-1111-1111-111111111111';
const WORKER = '22222222-2222-2222-2222-222222222222';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const AGREEMENT = 'a1b2c3de-0000-4000-8000-000000000001';
const CATALOG = '44444444-4444-4444-4444-444444444444';
const TODAY = '2026-09-15';
const SETTINGS = DEFAULT_ROUNDS_SETTINGS;

type JobRow = {
  id: string;
  tenant_id: string;
  service_agreement_id: string;
  agreement_occurrence_date: string;
  scheduled_date: string;
  status: string;
  assigned_worker_id: string | null;
};

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
  jobs: JobRow[];
  history: Record<string, unknown>[];
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
    let op: 'select' | 'upsert' | 'insert' | 'update' = 'select';
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
        return mode === 'maybeSingle'
          ? { data, error: null }
          : { data: [data], error: null };
      }

      if (table === 'workers' && op === 'select') {
        return { data: db.worker, error: null };
      }

      if (table === 'service_catalog' && op === 'select') {
        const idFilter = filters.find((f) => f.kind === 'eq' && f.col === 'id');
        const id = idFilter && idFilter.kind === 'eq' ? String(idFilter.val) : '';
        const name = db.catalog[id];
        const data = name ? { name } : null;
        return { data, error: null };
      }

      if (table === 'service_agreements') {
        if (op === 'select') {
          const rows = db.agreements.filter((row) => matches(row, filters));
          return { data: rows, error: null };
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
          const rows = (payload as JobRow[]) ?? [];
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
        if (op === 'select') {
          const rows = db.jobs.filter((job) => matches(job as unknown as Record<string, unknown>, filters));
          if (countHead) return { data: null, error: null, count: rows.length };
          return { data: rows, error: null };
        }
      }

      if (table === 'job_status_history' && op === 'insert') {
        const rows = Array.isArray(payload) ? payload : [payload];
        db.history.push(...(rows as Record<string, unknown>[]));
        return { data: rows, error: null };
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
    service_catalog_id: CATALOG,
    title: 'Window clean',
    address: '12 Elm Road',
    postcode: 'SW1A 1AA',
    lat: 51.5,
    lng: -0.1,
    price: 15,
    duration_minutes: 30,
    frequency_days: 28,
    anchor_date: TODAY,
    preferred_weekday: 5,
    preferred_time: '09:00:00',
    schedule_mode: 'fixed',
    next_due_date: TODAY,
    last_generated_at: null,
    status: 'active',
    paused_until: null,
    ended_at: null,
    assigned_worker_id: null,
    default_payment_method: null,
    reminder_enabled: true,
    access_notes: 'Side gate',
    notes: null,
    created_at: null,
    updated_at: null,
    ...over,
  };
}

function emptyDb(over: Partial<FakeDb> = {}): FakeDb {
  return {
    settings: { rounds: DEFAULT_ROUNDS_SETTINGS },
    worker: {
      id: WORKER,
      full_name: 'Pat Rounder',
      home_postcode: 'SW1A 1AA',
      home_lat: 51.5,
      home_lng: -0.1,
      expo_push_token: null,
    },
    catalog: { [CATALOG]: 'Window clean (front)' },
    agreements: [],
    jobs: [],
    history: [],
    nextJobId: 1,
    ...over,
  };
}

describe('mapAgreementRow', () => {
  it('coerces numeric strings from Postgres', () => {
    const mapped = mapAgreementRow({
      ...agreement(),
      lat: '51.5',
      lng: '-0.10',
      price: '15.00',
      preferred_weekday: '5',
    } as unknown as Record<string, unknown>);
    expect(mapped?.lat).toBe(51.5);
    expect(mapped?.lng).toBe(-0.1);
    expect(mapped?.price).toBe(15);
    expect(mapped?.preferred_weekday).toBe(5);
  });
});

describe('getRoundsSettings / getSoloWorkerForTenant', () => {
  it('reads tenants.settings.rounds and falls back when missing', async () => {
    const withRounds = createFakeSupabase(emptyDb());
    expect(await getRoundsSettings(withRounds, TENANT)).toEqual(DEFAULT_ROUNDS_SETTINGS);

    const empty = createFakeSupabase(emptyDb({ settings: {} }));
    expect(await getRoundsSettings(empty, TENANT)).toEqual(DEFAULT_ROUNDS_SETTINGS);
  });

  it('returns the platform_solo worker, or null', async () => {
    const db = emptyDb();
    expect(await getSoloWorkerForTenant(createFakeSupabase(db), TENANT)).toEqual({
      id: WORKER,
      full_name: 'Pat Rounder',
      home_postcode: 'SW1A 1AA',
      home_lat: 51.5,
      home_lng: -0.1,
      expo_push_token: null,
    });
    db.worker = null;
    expect(await getSoloWorkerForTenant(createFakeSupabase(db), TENANT)).toBeNull();
  });
});

describe('generateVisitsForAgreement', () => {
  it('returns the cursor unchanged when there is nothing to plan', async () => {
    const db = emptyDb();
    const result = await generateVisitsForAgreement(createFakeSupabase(db), {
      tenantId: TENANT,
      agreement: agreement({ status: 'paused' }),
      settings: SETTINGS,
      workerId: WORKER,
      today: TODAY,
    });
    expect(result).toEqual({
      inserted: 0,
      droppedPast: 0,
      nextDueDate: TODAY,
    });
    expect(db.jobs).toHaveLength(0);
  });

  it('inserts the fixed horizon, writes history, and advances the cursor', async () => {
    const db = emptyDb();
    const agr = agreement();
    db.agreements = [{ ...agr }];
    const result = await generateVisitsForAgreement(createFakeSupabase(db), {
      tenantId: TENANT,
      agreement: agr,
      settings: SETTINGS,
      workerId: WORKER,
      today: TODAY,
    });

    expect(result.inserted).toBe(3);
    expect(result.droppedPast).toBe(0);
    expect(result.nextDueDate).toBe(nextDueAfter('2026-11-10', 28));
    expect(db.jobs).toHaveLength(3);
    expect(db.jobs.every((job) => job.assigned_worker_id === WORKER)).toBe(true);
    expect(db.history).toHaveLength(3);
    expect(db.history[0]).toMatchObject({
      from_status: null,
      to_status: 'assigned',
      notes: 'Generated from agreement',
      metadata: { agreement_id: AGREEMENT },
    });
    expect(db.agreements[0]?.next_due_date).toBe(result.nextDueDate);
    expect(db.agreements[0]?.last_generated_at).toEqual(expect.any(String));
  });

  it('is idempotent: a second run inserts 0 and does not rewrite the cursor', async () => {
    const db = emptyDb();
    const agr = agreement();
    db.agreements = [{ ...agr }];
    const client = createFakeSupabase(db);
    const first = await generateVisitsForAgreement(client, {
      tenantId: TENANT,
      agreement: agr,
      settings: SETTINGS,
      workerId: WORKER,
      today: TODAY,
    });
    const updated = mapAgreementRow(db.agreements[0] as Record<string, unknown>)!;
    const second = await generateVisitsForAgreement(client, {
      tenantId: TENANT,
      agreement: updated,
      settings: SETTINGS,
      workerId: WORKER,
      today: TODAY,
    });
    expect(first.inserted).toBe(3);
    expect(second.inserted).toBe(0);
    expect(second.droppedPast).toBe(0);
    expect(second.nextDueDate).toBe(first.nextDueDate);
    expect(db.jobs).toHaveLength(3);
  });

  it('counts dropped past occurrences and still advances the cursor', async () => {
    const db = emptyDb();
    const agr = agreement({
      next_due_date: '2026-09-01',
      frequency_days: 90,
      preferred_weekday: null,
    });
    db.agreements = [{ ...agr }];
    const result = await generateVisitsForAgreement(createFakeSupabase(db), {
      tenantId: TENANT,
      agreement: agr,
      settings: SETTINGS,
      workerId: WORKER,
      today: TODAY,
    });
    expect(result.inserted).toBe(0);
    expect(result.droppedPast).toBe(1);
    expect(result.nextDueDate).toBe(nextDueAfter('2026-09-01', 90));
    expect(db.jobs).toHaveLength(0);
    expect(db.agreements[0]?.next_due_date).toBe(result.nextDueDate);
  });
});

describe('generateVisitsForTenant', () => {
  it('resumes a pause that has ended, then fills the fixed horizon', async () => {
    const agr = agreement({
      status: 'paused',
      paused_until: TODAY,
      next_due_date: '2026-08-18',
      preferred_weekday: null,
    });
    const db = emptyDb({ agreements: [{ ...agr }] });
    const result = await generateVisitsForTenant(createFakeSupabase(db), {
      tenantId: TENANT,
      today: TODAY,
    });
    expect(result.resumed).toBe(1);
    expect(result.agreements).toBe(1);
    expect(result.inserted).toBeGreaterThan(0);
    expect(db.agreements[0]?.status).toBe('active');
    expect(db.agreements[0]?.paused_until).toBeNull();
  });

  it('backfills after_completion only when no outstanding visit exists', async () => {
    const agr = agreement({
      schedule_mode: 'after_completion',
      frequency_days: 7,
      preferred_weekday: null,
    });
    const db = emptyDb({ agreements: [{ ...agr }] });
    const client = createFakeSupabase(db);

    const first = await generateVisitsForTenant(client, { tenantId: TENANT, today: TODAY });
    expect(first.agreements).toBe(1);
    expect(first.inserted).toBe(1);
    expect(db.jobs).toHaveLength(1);

    const second = await generateVisitsForTenant(client, { tenantId: TENANT, today: TODAY });
    expect(second.agreements).toBe(0);
    expect(second.inserted).toBe(0);
    expect(db.jobs).toHaveLength(1);
  });

  it('does not generate a fixed agreement whose cursor is past the horizon', async () => {
    const pastHorizon = nextDueAfter(horizonEnd(TODAY, SETTINGS), 28);
    const agr = agreement({ next_due_date: pastHorizon, preferred_weekday: null });
    const db = emptyDb({ agreements: [{ ...agr }] });
    const result = await generateVisitsForTenant(createFakeSupabase(db), {
      tenantId: TENANT,
      today: TODAY,
    });
    expect(result.agreements).toBe(0);
    expect(result.inserted).toBe(0);
    expect(db.jobs).toHaveLength(0);
  });
});

describe('history insert failure is non-fatal', () => {
  it('still returns inserted when history write fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = emptyDb();
    const agr = agreement({ service_catalog_id: null, preferred_weekday: null });
    db.agreements = [{ ...agr }];
    const client = createFakeSupabase(db);
    const originalFrom = client.from.bind(client);
    client.from = ((table: string) => {
      const builder = originalFrom(table) as ReturnType<typeof originalFrom> & {
        insert: (rows: unknown) => unknown;
      };
      if (table === 'job_status_history') {
        return {
          insert: () => Promise.resolve({ data: null, error: { message: 'nope' } }),
        };
      }
      return builder;
    }) as typeof client.from;

    const result = await generateVisitsForAgreement(client, {
      tenantId: TENANT,
      agreement: agr,
      settings: SETTINGS,
      workerId: WORKER,
      today: TODAY,
    });
    expect(result.inserted).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
