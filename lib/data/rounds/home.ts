import { createClient } from '@/lib/supabase/server';
import { addDays, isoWeekday, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-transitions';
import { getVisitsForDay, type VisitRow } from './visits';

export type RoundsHomeData = {
  today: Ymd;
  todayVisits: VisitRow[];
  todayDone: number;
  todayPlannedAmount: number;
  weekVisitCount: number;
  activeCustomers: number;
  activeAgreements: number;
  unorderedToday: boolean;
  catalogEmpty: boolean;
};

const EMPTY: Omit<RoundsHomeData, 'today'> = {
  todayVisits: [],
  todayDone: 0,
  todayPlannedAmount: 0,
  weekVisitCount: 0,
  activeCustomers: 0,
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

export async function getRoundsHomeData(tenantId: string): Promise<RoundsHomeData> {
  const today = todayInLondon();
  const weekStart = addDays(today, -(isoWeekday(today) - 1));
  const weekEnd = addDays(weekStart, 6);

  try {
    const supabase = await createClient();
    const [
      todayResult,
      weekResult,
      customersResult,
      agreementsResult,
      catalogResult,
    ] = await Promise.all([
      getVisitsForDay(tenantId, today),
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
    ]);

    if (todayResult.error) console.error('[getRoundsHomeData] today', todayResult.error);
    if (weekResult.error) console.error('[getRoundsHomeData] week', weekResult.error);
    if (customersResult.error) {
      console.error('[getRoundsHomeData] customers', customersResult.error);
    }
    if (agreementsResult.error) {
      console.error('[getRoundsHomeData] agreements', agreementsResult.error);
    }
    if (catalogResult.error) console.error('[getRoundsHomeData] catalog', catalogResult.error);

    const todayVisits = todayResult.visits;
    const summary = summariseTodayVisits(todayVisits);

    return {
      today,
      todayVisits,
      todayDone: summary.todayDone,
      todayPlannedAmount: summary.todayPlannedAmount,
      weekVisitCount: countOrZero(weekResult.count),
      activeCustomers: countOrZero(customersResult.count),
      activeAgreements: countOrZero(agreementsResult.count),
      unorderedToday: summary.unorderedToday,
      catalogEmpty: countOrZero(catalogResult.count) === 0,
    };
  } catch (err) {
    console.error('[getRoundsHomeData]', err);
    return { today, ...EMPTY };
  }
}
