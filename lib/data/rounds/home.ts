import { createClient } from '@/lib/supabase/server';
import { addDays, isoWeekday, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-transitions';
import { getOwedCustomers } from '@/lib/data/payments/owed';
import { getVisitsForDay, type VisitRow } from './visits';

export type RoundsHomeData = {
  /** Selected day (London Ymd). Defaults to today when the URL has no `date`. */
  today: Ymd;
  isToday: boolean;
  todayVisits: VisitRow[];
  todayDone: number;
  todayPlannedAmount: number;
  weekVisitCount: number;
  activeCustomers: number;
  owedTotal: number;
  owedCustomers: number;
  /** The customers who owe the most, up to 3. */
  owedTop: Array<{ name: string; amount: number; oldestUnpaidDate: string | null }>;
  /** The oldest unpaid visit date across everyone who owes. */
  owedOldestDate: string | null;
  activeAgreements: number;
  unorderedToday: boolean;
  catalogEmpty: boolean;
};

const EMPTY: Omit<RoundsHomeData, 'today' | 'isToday'> = {
  todayVisits: [],
  todayDone: 0,
  todayPlannedAmount: 0,
  weekVisitCount: 0,
  activeCustomers: 0,
  owedTotal: 0,
  owedCustomers: 0,
  owedTop: [],
  owedOldestDate: null,
  activeAgreements: 0,
  unorderedToday: false,
  catalogEmpty: true,
};

function countOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function summariseTodayVisits(visits: VisitRow[]): {
  todayDone: number;
  todayPlannedAmount: number;
  unorderedToday: boolean;
} {
  let todayDone = 0;
  let todayPlannedAmount = 0;
  let leftoverWithoutOrder = false;
  const leftover = new Set<string>(RESCHEDULE_STATUSES);

  for (const visit of visits) {
    if (visit.status === 'completed') todayDone += 1;
    if (visit.status !== 'cancelled') {
      todayPlannedAmount += visit.quoted_amount ?? 0;
    }
    if (leftover.has(visit.status) && visit.route_position == null) {
      leftoverWithoutOrder = true;
    }
  }

  return {
    todayDone,
    todayPlannedAmount,
    unorderedToday: leftoverWithoutOrder,
  };
}

export async function getRoundsHomeData(
  tenantId: string,
  selectedDate?: Ymd,
): Promise<RoundsHomeData> {
  const londonToday = todayInLondon();
  const day = selectedDate ?? londonToday;
  const isToday = day === londonToday;
  const weekStart = addDays(day, -(isoWeekday(day) - 1));
  const weekEnd = addDays(weekStart, 6);

  try {
    const supabase = await createClient();
    const [
      dayResult,
      weekResult,
      customersResult,
      agreementsResult,
      catalogResult,
      owedResult,
    ] = await Promise.all([
      getVisitsForDay(tenantId, day),
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('scheduled_date', weekStart)
        .lte('scheduled_date', weekEnd),
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('is_active', true),
      supabase
        .from('service_agreements')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active'),
      supabase
        .from('service_catalog')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('is_active', true),
      getOwedCustomers(supabase, tenantId),
    ]);

    if (dayResult.error) console.error('[getRoundsHomeData] day', dayResult.error);
    if (weekResult.error) console.error('[getRoundsHomeData] week', weekResult.error);
    if (customersResult.error) {
      console.error('[getRoundsHomeData] customers', customersResult.error);
    }
    if (agreementsResult.error) {
      console.error('[getRoundsHomeData] agreements', agreementsResult.error);
    }
    if (catalogResult.error) console.error('[getRoundsHomeData] catalog', catalogResult.error);

    const todayVisits = dayResult.visits;
    const summary = summariseTodayVisits(todayVisits);

    return {
      today: day,
      isToday,
      todayVisits,
      todayDone: summary.todayDone,
      todayPlannedAmount: summary.todayPlannedAmount,
      weekVisitCount: countOrZero(weekResult.count),
      activeCustomers: countOrZero(customersResult.count),
      owedTotal: owedResult.totalOwed,
      owedCustomers: owedResult.rows.filter((row) => row.owedAmount > 0).length,
      owedTop: owedResult.rows
        .filter((row) => row.owedAmount > 0)
        .sort((a, b) => b.owedAmount - a.owedAmount)
        .slice(0, 3)
        .map((row) => ({ name: row.name, amount: row.owedAmount, oldestUnpaidDate: row.oldestUnpaidDate })),
      owedOldestDate:
        owedResult.rows
          .filter((row) => row.owedAmount > 0 && row.oldestUnpaidDate)
          .map((row) => row.oldestUnpaidDate!.slice(0, 10))
          .sort()[0] ?? null,
      activeAgreements: countOrZero(agreementsResult.count),
      unorderedToday: summary.unorderedToday,
      catalogEmpty: countOrZero(catalogResult.count) === 0,
    };
  } catch (err) {
    console.error('[getRoundsHomeData]', err);
    return { today: day, isToday, ...EMPTY };
  }
}
