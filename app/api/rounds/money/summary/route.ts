import { getGetPaidChecklist } from '@/lib/data/payments/checklist';
import { getCashTakenOn } from '@/lib/data/payments/history';
import { getOwedCustomers } from '@/lib/data/payments/owed';
import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { sumHeldCash } from '@/lib/books/money-in';
import { createAdminClient } from '@/lib/supabase/admin';
import { todayInLondon } from '@/lib/rounds/dates';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const today = todayInLondon();
  const [checklist, owed, taken, cashWithTeam] = await Promise.all([
    getGetPaidChecklist(auth.ctx.supabase, auth.ctx.tenantId),
    getOwedCustomers(auth.ctx.supabase, auth.ctx.tenantId),
    getCashTakenOn(auth.ctx.supabase, auth.ctx.tenantId, today),
    sumHeldCash(createAdminClient(), auth.ctx.tenantId),
  ]);

  if (owed.error) {
    return roundsJson({ error: owed.error }, 400);
  }

  return roundsJson({
    checklist,
    totalOwed: owed.totalOwed,
    customersOwing: owed.rows.filter((row) => row.owedAmount > 0).length,
    totalCredit: owed.totalCredit,
    cashToday: taken.cash,
    chequeToday: taken.cheque,
    // Cash and cheques the team has collected and not yet handed over (not in the figures above).
    cashWithTeam,
  });
}
