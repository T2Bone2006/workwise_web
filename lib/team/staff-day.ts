import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, compareYmd, diffDays, isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { lastHelperIds } from '@/lib/team/crew-day';

/**
 * What a member of staff's phone is shown (D6, D7, D8): their own stops with the customer's phone number, the price
 * and what the customer owes. Nothing about other people's rounds, pay, other payments, invoices or settings.
 * Every query here is filtered by tenantId AND the caller's workerId; `db` is the service-role client.
 */

export type StaffCtx = { tenantId: string; workerId: string; personId: string };

export type StaffStop = {
  jobId: string;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
  title: string;
  price: number | null;
  durationMinutes: number | null;
  scheduledTime: string | null;
  status: string;
  routePosition: number | null;
  accessNotes: string | null;
  completionNotes: string | null;
  paymentStatus: string | null;
  customerOwes: number;
  addedByMe: boolean;
  heldByMeForThisVisit: number;
};

export type StaffDay = {
  date: Ymd;
  stops: StaffStop[];
  doneCount: number;
  plannedAmount: number;
  started: boolean;
  lastHelperIds: string[];
  /** Helpers, and other leads, the caller can tick as with them today. Never themselves. */
  helpers: Array<{ id: string; name: string; kind: 'lead' | 'helper' }>;
  heldTotal: number;
};

export type StaffRangeStop = {
  jobId: string;
  customerId: string | null;
  customerName: string;
  address: string;
  postcode: string;
  title: string;
  price: number | null;
  scheduledTime: string | null;
  status: string;
  routePosition: number | null;
  paymentStatus: string | null;
};

/** Counts for the month grid. `stops` is only present when the phone asks for the week board (`detail`). */
export type StaffRangeDay = { date: Ymd; total: number; done: number; plannedAmount: number; stops?: StaffRangeStop[] };

type JobRow = {
  id: string;
  customer_id: string | null;
  address: string | null;
  postcode: string | null;
  lat: number | string | null;
  lng: number | string | null;
  job_description: string | null;
  quoted_amount: number | string | null;
  estimated_duration_minutes: number | null;
  scheduled_time: string | null;
  scheduled_date: Ymd | null;
  status: string;
  route_position: number | null;
  completion_notes: string | null;
  payment_status: string | null;
  service_agreement_id: string | null;
};

/** Never shown to staff: work that has not been dispatched. */
const HIDDEN_STATUSES = ['pending', 'pending_send'] as const;
export const MAX_RANGE_DAYS = 62;

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function title(job: JobRow): string {
  return (job.job_description ?? '').split('\n')[0]!.trim().slice(0, 120) || 'Visit';
}

const SELECT_JOB =
  'id, customer_id, address, postcode, lat, lng, job_description, quoted_amount, estimated_duration_minutes, scheduled_time, scheduled_date, status, route_position, completion_notes, payment_status, service_agreement_id';

export async function getStaffDay(db: SupabaseClient, ctx: StaffCtx, date: Ymd): Promise<StaffDay> {
  const empty: StaffDay = { date, stops: [], doneCount: 0, plannedAmount: 0, started: false, lastHelperIds: [], helpers: [], heldTotal: 0 };

  const { data, error } = await db
    .from('jobs')
    .select(SELECT_JOB)
    .eq('tenant_id', ctx.tenantId)
    .eq('assigned_worker_id', ctx.workerId)
    .eq('scheduled_date', date)
    .not('status', 'in', `(${HIDDEN_STATUSES.join(',')})`);
  if (error || !Array.isArray(data)) {
    console.error('[staff-day] jobs:', error?.message);
    throw new Error('Could not load the day.');
  }
  const jobs = data as JobRow[];

  const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter((id): id is string => Boolean(id)))];
  const agreementIds = [...new Set(jobs.map((j) => j.service_agreement_id).filter((id): id is string => Boolean(id)))];
  const jobIds = jobs.map((j) => j.id);

  const [customers, agreements, balances, heldPerJob, heldAll, started, helperRows] = await Promise.all([
    customerIds.length
      ? db.from('customers').select('id, name, phone, access_notes, added_by_worker_id').eq('tenant_id', ctx.tenantId).in('id', customerIds)
      : Promise.resolve({ data: [] as unknown[] }),
    agreementIds.length
      ? db.from('service_agreements').select('id, access_notes').eq('tenant_id', ctx.tenantId).in('id', agreementIds)
      : Promise.resolve({ data: [] as unknown[] }),
    customerIds.length
      ? db.from('customer_balances').select('customer_id, owed_amount').eq('tenant_id', ctx.tenantId).in('customer_id', customerIds)
      : Promise.resolve({ data: [] as unknown[] }),
    jobIds.length
      ? db
          .from('payments')
          .select('applies_to_job_id, amount')
          .eq('tenant_id', ctx.tenantId)
          .eq('status', 'active')
          .eq('collected_by_worker_id', ctx.workerId)
          .is('handed_over_at', null)
          .in('applies_to_job_id', jobIds)
      : Promise.resolve({ data: [] as unknown[] }),
    db
      .from('payments')
      .select('amount')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'active')
      .eq('collected_by_worker_id', ctx.workerId)
      .is('handed_over_at', null),
    db.from('work_days').select('id').eq('tenant_id', ctx.tenantId).eq('person_id', ctx.personId).eq('work_date', date).limit(1),
    db.from('team_people').select('id, name, kind').eq('tenant_id', ctx.tenantId).in('kind', ['helper', 'lead']).is('ended_at', null),
  ]);

  const customerById = new Map<string, { name: string; phone: string | null; access: string | null; addedBy: string | null }>();
  for (const c of (customers.data ?? []) as Array<{ id: string; name: string; phone: string | null; access_notes: string | null; added_by_worker_id: string | null }>) {
    customerById.set(c.id, { name: c.name, phone: c.phone, access: c.access_notes, addedBy: c.added_by_worker_id });
  }
  const accessByAgreement = new Map<string, string | null>();
  for (const a of (agreements.data ?? []) as Array<{ id: string; access_notes: string | null }>) accessByAgreement.set(a.id, a.access_notes);
  const owedByCustomer = new Map<string, number>();
  for (const b of (balances.data ?? []) as Array<{ customer_id: string; owed_amount: unknown }>) owedByCustomer.set(b.customer_id, num(b.owed_amount) ?? 0);
  const heldByJob = new Map<string, number>();
  for (const p of (heldPerJob.data ?? []) as Array<{ applies_to_job_id: string | null; amount: unknown }>) {
    if (p.applies_to_job_id) heldByJob.set(p.applies_to_job_id, (heldByJob.get(p.applies_to_job_id) ?? 0) + (num(p.amount) ?? 0));
  }
  const heldTotal = ((heldAll.data ?? []) as Array<{ amount: unknown }>).reduce((sum, p) => sum + (num(p.amount) ?? 0), 0);

  const stops: StaffStop[] = jobs
    .map((job): StaffStop => {
      const customer = job.customer_id ? customerById.get(job.customer_id) : undefined;
      const access = (job.service_agreement_id ? accessByAgreement.get(job.service_agreement_id) : null) ?? customer?.access ?? null;
      return {
        jobId: job.id,
        customerId: job.customer_id,
        customerName: customer?.name ?? 'Customer',
        phone: customer?.phone ?? null,
        address: job.address ?? '',
        postcode: job.postcode ?? '',
        lat: num(job.lat),
        lng: num(job.lng),
        title: title(job),
        price: num(job.quoted_amount),
        durationMinutes: job.estimated_duration_minutes,
        scheduledTime: job.scheduled_time,
        status: job.status,
        routePosition: job.route_position,
        accessNotes: access && access.trim() !== '' ? access.trim() : null,
        completionNotes: job.completion_notes,
        paymentStatus: job.payment_status,
        customerOwes: job.customer_id ? (owedByCustomer.get(job.customer_id) ?? 0) : 0,
        addedByMe: customer?.addedBy === ctx.workerId,
        heldByMeForThisVisit: heldByJob.get(job.id) ?? 0,
      };
    })
    .sort((a, b) => {
      const pa = a.routePosition ?? Number.MAX_SAFE_INTEGER;
      const pb = b.routePosition ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const ta = a.scheduledTime ?? '99:99';
      const tb = b.scheduledTime ?? '99:99';
      return ta !== tb ? ta.localeCompare(tb) : a.jobId.localeCompare(b.jobId);
    });

  return {
    ...empty,
    stops,
    doneCount: stops.filter((s) => s.status === 'completed').length,
    plannedAmount: stops.filter((s) => s.status !== 'cancelled').reduce((sum, s) => sum + (s.price ?? 0), 0),
    started: Array.isArray(started.data) && started.data.length > 0,
    lastHelperIds: await lastHelperIds(db, ctx.tenantId, ctx.personId),
    helpers: ((helperRows.data ?? []) as Array<{ id: string; name: string; kind: string }>)
      .filter((h) => h.id !== ctx.personId && (h.kind === 'lead' || h.kind === 'helper'))
      .map((h) => ({ id: h.id, name: h.name, kind: h.kind as 'lead' | 'helper' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    heldTotal,
  };
}

type RangeJob = {
  id: string;
  customer_id: string | null;
  address: string | null;
  postcode: string | null;
  job_description: string | null;
  quoted_amount: unknown;
  scheduled_time: string | null;
  scheduled_date: Ymd | null;
  status: string;
  route_position: number | null;
  payment_status: string | null;
};

/** The staff calendar: counts per day for their own visits between two dates (at most 62 days). `detail` adds each stop, for the week board. */
export async function getStaffRange(
  db: SupabaseClient,
  ctx: StaffCtx,
  from: Ymd,
  to: Ymd,
  detail = false,
): Promise<{ ok: true; days: StaffRangeDay[] } | { ok: false; error: string }> {
  if (!isValidYmd(from) || !isValidYmd(to) || compareYmd(to, from) < 0) return { ok: false, error: 'Pick a valid range.' };
  if (diffDays(from, to) + 1 > MAX_RANGE_DAYS) return { ok: false, error: `Pick ${MAX_RANGE_DAYS} days or fewer.` };

  const { data, error } = await db
    .from('jobs')
    .select(
      detail
        ? 'id, customer_id, address, postcode, job_description, quoted_amount, scheduled_time, scheduled_date, status, route_position, payment_status'
        : 'scheduled_date, status, quoted_amount',
    )
    .eq('tenant_id', ctx.tenantId)
    .eq('assigned_worker_id', ctx.workerId)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .not('status', 'in', `(${HIDDEN_STATUSES.join(',')})`);
  if (error || !Array.isArray(data)) return { ok: false, error: 'Could not load the calendar.' };

  const rows = data as unknown as RangeJob[];
  const nameById = new Map<string, string>();
  if (detail) {
    const customerIds = [...new Set(rows.map((row) => row.customer_id).filter((id): id is string => Boolean(id)))];
    if (customerIds.length > 0) {
      const customers = await db.from('customers').select('id, name').eq('tenant_id', ctx.tenantId).in('id', customerIds);
      for (const customer of (customers.data ?? []) as Array<{ id: string; name: string }>) nameById.set(customer.id, customer.name);
    }
  }

  const byDay = new Map<Ymd, StaffRangeDay>();
  for (const row of rows) {
    if (!row.scheduled_date) continue;
    const day = byDay.get(row.scheduled_date) ?? { date: row.scheduled_date, total: 0, done: 0, plannedAmount: 0, ...(detail ? { stops: [] as StaffRangeStop[] } : {}) };
    day.total += 1;
    if (row.status === 'completed') day.done += 1;
    if (row.status !== 'cancelled') day.plannedAmount += num(row.quoted_amount) ?? 0;
    if (detail && day.stops && row.id) {
      day.stops.push({
        jobId: row.id,
        customerId: row.customer_id,
        customerName: (row.customer_id ? nameById.get(row.customer_id) : undefined) || 'Stop',
        address: row.address ?? '',
        postcode: row.postcode ?? '',
        title: (row.job_description ?? '').split('\n')[0]!.trim().slice(0, 120) || 'Visit',
        price: num(row.quoted_amount),
        scheduledTime: row.scheduled_time,
        status: row.status,
        routePosition: row.route_position,
        paymentStatus: row.payment_status,
      });
    }
    byDay.set(row.scheduled_date, day);
  }
  const days: StaffRangeDay[] = [];
  for (let d = from; compareYmd(d, to) <= 0; d = addDays(d, 1)) {
    days.push(byDay.get(d) ?? { date: d, total: 0, done: 0, plannedAmount: 0, ...(detail ? { stops: [] } : {}) });
  }
  return { ok: true, days };
}
