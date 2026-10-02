import { unexpected } from '@/lib/api/direct-debit-request';
import { requireExpensesApi } from '@/lib/api/expenses-request';
import { roundsJson } from '@/lib/api/rounds-request';
import { parsePeriodParam } from '@/lib/books/periods';
import { loadBooksSummary } from '@/lib/books/summary';
import { listDraftExpenses } from '@/lib/data/expenses';

export const runtime = 'nodejs';

/** In & out for the phone card, plus how many receipts are still To check. */
export async function GET(request: Request) {
  const auth = await requireExpensesApi(request);
  if (!auth.ok) return auth.response;
  const { supabase, tenantId } = auth.ctx;

  try {
    const period = parsePeriodParam(new URL(request.url).searchParams.get('period') ?? undefined);
    const [summary, drafts] = await Promise.all([
      loadBooksSummary(supabase, { tenantId, period }),
      listDraftExpenses(supabase, tenantId),
    ]);
    return roundsJson({
      moneyIn: summary.moneyIn,
      moneyOut: summary.moneyOut,
      left: summary.left,
      paymentsCount: summary.paymentsCount,
      label: summary.period.label,
      toCheckCount: drafts.length,
    });
  } catch (err) {
    return unexpected('GET /api/rounds/books/summary', err);
  }
}
