import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, londonDayBoundsUtc, startOfMonth, type Ymd } from '@/lib/rounds/dates';
import type { PaymentMethod } from '@/lib/payments/money-core';
import type { LedgerPayment } from '@/lib/data/payments/ledger';

export type PaymentHistoryRow = LedgerPayment & {
  customerId: string;
  customerName: string;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function mapHistoryRow(raw: Record<string, unknown>): PaymentHistoryRow | null {
  const id = asString(raw.id);
  const method = asString(raw.method) as PaymentMethod | null;
  const source = asString(raw.source) as LedgerPayment['source'] | null;
  const status = asString(raw.status) as LedgerPayment['status'] | null;
  const receivedAt = asString(raw.received_at);
  const amount = asFiniteNumber(raw.amount);
  if (!id || !method || !source || !status || !receivedAt || amount == null) {
    return null;
  }

  let customer: Record<string, unknown> | null = null;
  const embed = raw.customers;
  if (Array.isArray(embed)) {
    customer = (embed[0] as Record<string, unknown>) ?? null;
  } else if (embed && typeof embed === 'object') {
    customer = embed as Record<string, unknown>;
  }

  const customerId = asString(raw.customer_id) ?? asString(customer?.id);
  const customerName = asString(customer?.name);
  if (!customerId || !customerName) return null;

  const allocations: { jobId: string; amount: number }[] = [];
  const allocEmbed = raw.payment_allocations;
  const list = Array.isArray(allocEmbed)
    ? allocEmbed
    : allocEmbed
      ? [allocEmbed]
      : [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const jobId = asString((a as { job_id?: unknown }).job_id);
    const amt = asFiniteNumber((a as { amount?: unknown }).amount);
    if (jobId && amt != null) allocations.push({ jobId, amount: amt });
  }

  return {
    id,
    amount,
    refundedAmount: asFiniteNumber(raw.refunded_amount) ?? 0,
    method,
    source,
    status,
    receivedAt,
    note: asString(raw.note),
    appliesToJobId: asString(raw.applies_to_job_id),
    invoiceId: asString(raw.invoice_id),
    disputedAt: asString(raw.disputed_at),
    disputeStatus: asString(raw.dispute_status),
    voidReason: asString(raw.void_reason),
    allocations,
    customerId,
    customerName,
  };
}

export async function getPaymentHistory(
  supabase: SupabaseClient,
  tenantId: string,
  opts?: {
    from?: string;
    to?: string;
    method?: PaymentMethod;
    includeVoid?: boolean;
    limit?: number;
  },
): Promise<{ rows: PaymentHistoryRow[]; error: string | null }> {
  let query = supabase
    .from('payments')
    .select(
      [
        'id',
        'customer_id',
        'amount',
        'refunded_amount',
        'method',
        'source',
        'status',
        'received_at',
        'note',
        'applies_to_job_id',
        'invoice_id',
        'disputed_at',
        'dispute_status',
        'void_reason',
        'customers ( id, name )',
        'payment_allocations ( job_id, amount )',
      ].join(', '),
    )
    .eq('tenant_id', tenantId)
    .order('received_at', { ascending: false })
    .limit(opts?.limit ?? 100);

  if (!opts?.includeVoid) {
    query = query.eq('status', 'active');
  }
  if (opts?.method) {
    query = query.eq('method', opts.method);
  }
  if (opts?.from) {
    query = query.gte('received_at', opts.from);
  }
  if (opts?.to) {
    query = query.lte('received_at', opts.to);
  }

  const { data, error } = await query;
  if (error) {
    console.error('getPaymentHistory failed', error);
    return { rows: [], error: error.message };
  }

  const rows: PaymentHistoryRow[] = [];
  for (const raw of data ?? []) {
    const row = mapHistoryRow(raw as unknown as Record<string, unknown>);
    if (row) rows.push(row);
  }
  return { rows, error: null };
}

/** Sum of active cash + cheque payments whose received_at falls on this London date. */
export async function getCashTakenOn(
  supabase: SupabaseClient,
  tenantId: string,
  date: string,
): Promise<{ cash: number; cheque: number }> {
  const { startIso, endIso } = londonDayBoundsUtc(date);

  const { data, error } = await supabase
    .from('payments')
    .select('amount, method')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .in('method', ['cash', 'cheque'])
    .gte('received_at', startIso)
    .lt('received_at', endIso);

  if (error) {
    console.error('getCashTakenOn failed', error);
    return { cash: 0, cheque: 0 };
  }

  let cash = 0;
  let cheque = 0;
  for (const raw of data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const amount = asFiniteNumber(row.amount) ?? 0;
    if (row.method === 'cash') cash += amount;
    if (row.method === 'cheque') cheque += amount;
  }
  return {
    cash: Math.round(cash * 100) / 100,
    cheque: Math.round(cheque * 100) / 100,
  };
}

export type EarningsPoint = {
  date: Ymd;
  /** Money that arrived on this day, whatever day the visit was. */
  income: number;
  /** Visits on this day that are not done yet. */
  booked: number;
  /** Finished visits on this day that are still unpaid. */
  owed: number;
  /** Finished visits on this day that have been paid. */
  paid: number;
  /** booked + owed + paid. Cancelled visits are left out. */
  work: number;
};

export type EarningsHour = {
  hour: number;
  income: number;
  booked: number;
  owed: number;
  paid: number;
};

export type EarningsOverview = {
  month: number;
  points: EarningsPoint[];
  /** Today's money and visits split by hour, so the Today chart is not one bar. */
  hours: EarningsHour[];
  error: string | null;
};

function emptyHours(): EarningsHour[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    income: 0,
    booked: 0,
    owed: 0,
    paid: 0,
  }));
}

function londonHour(iso: string): number | null {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(iso))
    .find((part) => part.type === 'hour')?.value;
  if (!hour) return null;
  const parsed = Number(hour);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null;
}

function clockHour(value: string): number | null {
  const match = /^(\d{2})/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return parsed >= 0 && parsed <= 23 ? parsed : null;
}

function londonYmd(iso: string): Ymd | null {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
}

/** One point per day this year: money in, and visits still booked. */
export async function getEarningsOverview(
  supabase: SupabaseClient,
  tenantId: string,
  today: Ymd,
): Promise<EarningsOverview> {
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const days = yearDays(yearStart, yearEnd);
  const emptyPoints: EarningsPoint[] = days.map((date) => ({
    date,
    income: 0,
    booked: 0,
    owed: 0,
    paid: 0,
    work: 0,
  }));
  const empty: EarningsOverview = { month: 0, points: emptyPoints, hours: emptyHours(), error: null };
  const monthStart = startOfMonth(today);
  const from = londonDayBoundsUtc(yearStart).startIso;
  const to = londonDayBoundsUtc(today).endIso;

  const [paymentsResult, visitsResult, allocResult] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, received_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .gte('received_at', from)
      .lt('received_at', to)
      .limit(5000),
    supabase
      .from('jobs')
      .select('id, scheduled_date, scheduled_time, completed_at, status, quoted_amount, final_amount, payment_status')
      .eq('tenant_id', tenantId)
      .gte('scheduled_date', yearStart)
      .lte('scheduled_date', yearEnd),
    supabase
      .from('payment_allocations')
      .select('job_id, amount, payments!inner(status)')
      .eq('tenant_id', tenantId)
      .eq('payments.status', 'active'),
  ]);

  if (paymentsResult.error) {
    console.error('getEarningsOverview payments failed', paymentsResult.error);
    return { ...empty, error: paymentsResult.error.message };
  }

  const income = new Map<Ymd, number>();
  const booked = new Map<Ymd, number>();
  const owed = new Map<Ymd, number>();
  const paid = new Map<Ymd, number>();
  const hours = emptyHours();
  let monthTotal = 0;

  for (const raw of paymentsResult.data ?? []) {
    const row = raw as { amount?: unknown; received_at?: unknown };
    const amount = asFiniteNumber(row.amount) ?? 0;
    const day = typeof row.received_at === 'string' ? londonYmd(row.received_at) : null;
    if (!day) continue;
    income.set(day, (income.get(day) ?? 0) + amount);
    if (day >= monthStart && day <= today) monthTotal += amount;
    if (day === today && typeof row.received_at === 'string') {
      const hour = londonHour(row.received_at);
      if (hour != null) hours[hour]!.income += amount;
    }
  }

  const allocatedByJob = new Map<string, number>();
  if (allocResult.error) {
    console.error('getEarningsOverview allocations failed', allocResult.error);
  } else {
    for (const raw of allocResult.data ?? []) {
      const row = raw as { job_id?: unknown; amount?: unknown };
      const jobId = typeof row.job_id === 'string' ? row.job_id : null;
      if (!jobId) continue;
      allocatedByJob.set(jobId, (allocatedByJob.get(jobId) ?? 0) + (asFiniteNumber(row.amount) ?? 0));
    }
  }

  if (visitsResult.error) {
    console.error('getEarningsOverview visits failed', visitsResult.error);
  } else {
    for (const raw of visitsResult.data ?? []) {
      const row = raw as {
        id?: unknown;
        scheduled_date?: unknown;
        scheduled_time?: unknown;
        completed_at?: unknown;
        status?: unknown;
        quoted_amount?: unknown;
        final_amount?: unknown;
        payment_status?: unknown;
      };
      if (row.status === 'cancelled' || row.payment_status === 'waived') continue;
      const day = typeof row.scheduled_date === 'string' ? row.scheduled_date : null;
      if (!day) continue;
      const due = asFiniteNumber(row.final_amount) ?? asFiniteNumber(row.quoted_amount) ?? 0;
      const visitHour =
        (typeof row.scheduled_time === 'string' ? clockHour(row.scheduled_time) : null) ??
        (typeof row.completed_at === 'string' ? londonHour(row.completed_at) : null);
      if (row.status !== 'completed') {
        booked.set(day, (booked.get(day) ?? 0) + due);
        if (day === today && visitHour != null) hours[visitHour]!.booked += due;
        continue;
      }
      const jobId = typeof row.id === 'string' ? row.id : null;
      const settled = Math.min(due, jobId ? (allocatedByJob.get(jobId) ?? 0) : 0);
      const stillOwed = Math.max(0, due - settled);
      paid.set(day, (paid.get(day) ?? 0) + settled);
      owed.set(day, (owed.get(day) ?? 0) + stillOwed);
      if (day === today && visitHour != null) {
        hours[visitHour]!.paid += settled;
        hours[visitHour]!.owed += stillOwed;
      }
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    month: round(monthTotal),
    hours: hours.map((bucket) => ({
      ...bucket,
      income: round(bucket.income),
      booked: round(bucket.booked),
      owed: round(bucket.owed),
      paid: round(bucket.paid),
    })),
    points: days.map((day) => {
      const bookedAmount = round(booked.get(day) ?? 0);
      const owedAmount = round(owed.get(day) ?? 0);
      const paidAmount = round(paid.get(day) ?? 0);
      return {
        date: day,
        income: round(income.get(day) ?? 0),
        booked: bookedAmount,
        owed: owedAmount,
        paid: paidAmount,
        work: round(bookedAmount + owedAmount + paidAmount),
      };
    }),
    error: null,
  };
}

function yearDays(start: Ymd, end: Ymd): Ymd[] {
  const days: Ymd[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}
