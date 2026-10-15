import 'server-only';

import { payRange, payTotals, visiblePeople, type PayPeriodKey, type TeamPayPageData, type TeamPayRow } from '@/lib/data/team-pay-page-core';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPayLedger, getPersonStatement } from '@/lib/team/pay';
import { listTeam } from '@/lib/team/team-read';

/**
 * Everything the Pay page shows: the ledger for the period, the strip totals, and (when a person is chosen) their
 * days and payments. All sums come from the step 18 loaders; nothing is added up in a component. Throws if the
 * ledger cannot be read (the page shows its "couldn't load" message).
 */
export async function getTeamPayPage(tenantId: string, periodKey: PayPeriodKey, personId?: string | null): Promise<TeamPayPageData> {
  const db = createAdminClient();
  const today = todayInLondon();
  const { range, label } = payRange(periodKey, today);

  const [ledger, team] = await Promise.all([getPayLedger(db, tenantId, range), listTeam(db, tenantId)]);
  const rateById = new Map(team.map((p) => [p.id, p.dayRatePence]));
  const rows: TeamPayRow[] = visiblePeople(ledger).map((p) => ({ ...p, dayRatePence: rateById.get(p.personId) ?? 0 }));

  let statement: TeamPayPageData['statement'] = null;
  if (personId) {
    const found = await getPersonStatement(db, tenantId, personId, range);
    if (found) {
      statement = {
        person: { ...found.person, dayRatePence: rateById.get(found.person.personId) ?? 0 },
        days: found.days,
        payments: found.payments,
      };
    }
  }

  return { periodKey, label, rows, totals: payTotals(rows), statement, today };
}
