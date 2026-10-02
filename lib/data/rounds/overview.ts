import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTrend, lastMonthToDate, trendMonthKeys, type TrendMonth } from '@/lib/books/trend';
import { readAllPages } from '@/lib/data/read-all-pages';
import { getPaymentHistory } from '@/lib/data/payments/history';
import { getVisitsForRange } from '@/lib/data/rounds/visits';
import { addDays, isoWeekday, londonDayBoundsUtc, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import type { RoundsSettings } from '@/lib/rounds/settings';
import { summariseWeek, type WeekGlance } from '@/lib/rounds/week-glance';
import { fromPence, toPence } from '@/lib/money/pence';

/*
 * The overview's extra reads (the Today card and "Needs you now" come from
 * home.ts and needs-you.ts). Each part fails on its own: a broken read shows
 * that card's "couldn't load" line, never a broken page.
 */

export type LatestPayment = { id: string; customerName: string; amount: number; method: string; receivedOn: Ymd };

export type RoundValue = {
  /** Active schedules. */
  schedules: number;
  /** What the active schedules bring in over an average month, at today's prices, to the nearest pound. */
  perMonth: number;
};

const TREND_MONTHS = 6;
const DAYS_PER_MONTH = 365.25 / 12;

/** This week, Monday to Sunday, with the business's working days. */
export async function loadWeekGlance(p: { tenantId: string; today: Ymd; settings: RoundsSettings }): Promise<WeekGlance | null> {
  const monday = addDays(p.today, 1 - isoWeekday(p.today));
  const { visits, error } = await getVisitsForRange(p.tenantId, monday, addDays(monday, 6));
  if (error) return null;
  return summariseWeek({ monday, today: p.today, visits, workingDays: p.settings.working_days, blackouts: p.settings.blackouts });
}

export type MoneyTrend = { months: TrendMonth[]; lastMonthToDate: number };

/** Money in and out for this month and the five before it, and last month "so far" for comparison. */
export async function loadMoneyTrend(db: SupabaseClient, p: { tenantId: string; today: Ymd }): Promise<MoneyTrend | null> {
  const keys = trendMonthKeys(p.today, TREND_MONTHS);
  const from = `${keys[0]}-01`;
  try {
    const [payments, expenses] = await Promise.all([
      readAllPages(
        (a, z) =>
          db
            .from('payments')
            .select('id, amount, refunded_amount, received_at')
            .eq('tenant_id', p.tenantId)
            .eq('status', 'active')
            .gte('received_at', londonDayBoundsUtc(from).startIso)
            .order('received_at', { ascending: true })
            .order('id', { ascending: true })
            .range(a, z),
        'Could not load payments',
      ),
      readAllPages(
        (a, z) =>
          db
            .from('expenses')
            .select('id, spent_on, amount')
            .eq('tenant_id', p.tenantId)
            .eq('status', 'confirmed')
            .gte('spent_on', from)
            .order('spent_on', { ascending: true })
            .order('id', { ascending: true })
            .range(a, z),
        'Could not load expenses',
      ),
    ]);
    const paid = payments.map((r) => ({
      date: todayInLondon(new Date(String(r.received_at))),
      amount: Number(r.amount) || 0,
      refunded: Number(r.refunded_amount) || 0,
    }));
    return {
      months: buildTrend({
        keys,
        payments: paid,
        expenses: expenses.map((r) => ({ date: String(r.spent_on), amount: Number(r.amount) || 0 })),
      }),
      lastMonthToDate: lastMonthToDate(paid, p.today),
    };
  } catch (err) {
    console.error('[loadMoneyTrend]', err instanceof Error ? err.message : 'failed');
    return null;
  }
}

export async function loadLatestPayments(db: SupabaseClient, tenantId: string): Promise<LatestPayment[] | null> {
  const { rows, error } = await getPaymentHistory(db, tenantId, { limit: 10 });
  if (error) return null;
  return rows
    .map((r) => ({
    id: r.id,
    customerName: r.customerName,
    amount: Math.max(0, fromPence(toPence(r.amount) - toPence(r.refundedAmount))),
    method: r.method,
    receivedOn: todayInLondon(new Date(r.receivedAt)),
    }))
    // A payment refunded in full brought nothing in.
    .filter((p) => p.amount > 0)
    .slice(0, 5);
}

/** What the regular work is worth: each active schedule's price, spread over an average month. */
export async function loadRoundValue(db: SupabaseClient, tenantId: string): Promise<RoundValue | null> {
  const { data, error } = await db
    .from('service_agreements')
    .select('price, frequency_days')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  if (error) return null;
  let pence = 0;
  for (const row of data ?? []) {
    const price = Number(row.price);
    const every = Number(row.frequency_days);
    if (Number.isFinite(price) && Number.isFinite(every) && every > 0) {
      pence += Math.round(toPence(price) * (DAYS_PER_MONTH / every));
    }
  }
  return { schedules: data?.length ?? 0, perMonth: Math.round(fromPence(pence)) };
}
