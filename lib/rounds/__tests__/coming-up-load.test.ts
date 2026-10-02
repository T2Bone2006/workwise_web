import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadComingUp } from '@/lib/data/rounds/coming-up';

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, failTable?: string) {
  const eqs: Array<[string, string, unknown]> = [];
  const db = {
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      let range: [number, number] | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (k: string, v: unknown) => { eqs.push([table, k, v]); preds.push((r) => r[k] === v); return b; };
      b.in = (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[k])); return b; };
      b.gte = (k: string, v: string) => { preds.push((r) => String(r[k]) >= v); return b; };
      b.lte = (k: string, v: string) => { preds.push((r) => String(r[k]) <= v); return b; };
      b.not = (k: string, _op: string, list: string) => {
        const out = list.replace(/[()]/g, '').split(',');
        preds.push((r) => !out.includes(String(r[k])));
        return b;
      };
      b.order = () => b;
      b.range = (a: number, z: number) => { range = [a, z]; return b; };
      const run = () => {
        if (failTable === table) return { data: null, error: { message: 'boom' } };
        let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return { data: rows, error: null };
      };
      b.maybeSingle = async () => ({ data: run().data?.[0] ?? null, error: null });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, eqs };
}

const agreementRow = (over: Row = {}): Row => ({
  id: 'a1', tenant_id: 't1', customer_id: 'c1', title: 'Windows', address: '1 High St', postcode: 'WN1 1AA',
  price: 15, duration_minutes: 30, frequency_days: 7, anchor_date: '2026-09-01', preferred_weekday: null,
  schedule_mode: 'fixed', next_due_date: '2026-10-13', status: 'active', paused_until: null,
  reminder_enabled: true, ...over,
});

describe('loadComingUp', () => {
  it('counts this business\'s open visits plus forecast, and not done, skipped, or other businesses\' ones', async () => {
    const { db, eqs } = fakeDb({
      tenants: [{ id: 't1', settings: { rounds: { working_days: [1, 2, 3, 4, 5] } } }],
      jobs: [
        { id: 'j1', tenant_id: 't1', scheduled_date: '2026-10-08', quoted_amount: 20, status: 'assigned', service_agreement_id: null, agreement_occurrence_date: null },
        { id: 'j2', tenant_id: 't1', scheduled_date: '2026-10-08', quoted_amount: 20, status: 'completed' },
        { id: 'j3', tenant_id: 't1', scheduled_date: '2026-10-08', quoted_amount: 20, status: 'cancelled' },
        { id: 'j4', tenant_id: 't2', scheduled_date: '2026-10-08', quoted_amount: 99, status: 'assigned' },
        { id: 'j5', tenant_id: 't1', scheduled_date: '2026-12-25', quoted_amount: 99, status: 'assigned' },
      ],
      service_agreements: [agreementRow(), agreementRow({ id: 'a2', status: 'ended' }), agreementRow({ id: 'a3', tenant_id: 't2' })],
    });
    const c = await loadComingUp(db, { tenantId: 't1', weeks: 4, today: '2026-10-07' });
    expect(c.weeks[0]).toMatchObject({ stops: 1, amount: 20, forecastStops: 0 });
    expect(c.weeks[1]).toMatchObject({ stops: 1, amount: 15, forecastStops: 1 }); // the forecast from a1
    expect(c.totalStops).toBe(1 + 3); // one booked, then one a week from 13 Oct
    for (const table of ['jobs', 'service_agreements']) {
      expect(eqs.filter(([t, k]) => t === table && k === 'tenant_id').map(([, , v]) => v)).toEqual(['t1']);
    }
  });

  it('does not count an occurrence twice when it is booked', async () => {
    const { db } = fakeDb({
      tenants: [{ id: 't1', settings: {} }],
      jobs: [{ id: 'j1', tenant_id: 't1', scheduled_date: '2026-10-13', quoted_amount: 15, status: 'assigned', service_agreement_id: 'a1', agreement_occurrence_date: '2026-10-13' }],
      service_agreements: [agreementRow()],
    });
    const c = await loadComingUp(db, { tenantId: 't1', weeks: 4, today: '2026-10-07' });
    expect(c.weeks[1]).toMatchObject({ stops: 1, forecastStops: 0 });
  });

  it('throws on a read error instead of showing a wrong week', async () => {
    for (const failTable of ['jobs', 'service_agreements']) {
      const { db } = fakeDb({ tenants: [{ id: 't1', settings: {} }] }, failTable);
      await expect(loadComingUp(db, { tenantId: 't1', weeks: 4, today: '2026-10-07' })).rejects.toThrow(/Could not load/);
    }
  });

  it('with no agreements and no visits every week is empty', async () => {
    const { db } = fakeDb({ tenants: [{ id: 't1', settings: {} }] });
    const c = await loadComingUp(db, { tenantId: 't1', weeks: 8, today: '2026-10-07' });
    expect(c.weeks).toHaveLength(8);
    expect(c.totalStops).toBe(0);
  });
});
