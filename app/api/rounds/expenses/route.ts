import { unexpected } from '@/lib/api/direct-debit-request';
import { requireExpensesApi } from '@/lib/api/expenses-request';
import { firstZodError, readJsonBody, roundsJson } from '@/lib/api/rounds-request';
import { parsePeriodParam, periodRange } from '@/lib/books/periods';
import { listDraftExpenses, listExpenses } from '@/lib/data/expenses';
import { addExpenseCore } from '@/lib/expenses/expenses-core';
import { fromPence, toPence } from '@/lib/money/pence';
import { addExpenseSchema } from '@/lib/validations/expenses';

export const runtime = 'nodejs';

const NO_LONGER = 'This expense no longer exists.';

/** To check (always) plus saved expenses for the month. */
export async function GET(request: Request) {
  const auth = await requireExpensesApi(request);
  if (!auth.ok) return auth.response;
  const { supabase, tenantId } = auth.ctx;

  try {
    const period = periodRange(
      parsePeriodParam(new URL(request.url).searchParams.get('period') ?? undefined),
    );
    const [drafts, expenses] = await Promise.all([
      listDraftExpenses(supabase, tenantId),
      listExpenses(supabase, tenantId, period),
    ]);
    const total = fromPence(expenses.reduce((sum, row) => sum + toPence(row.amount ?? 0), 0));
    return roundsJson({ drafts, expenses, period, total });
  } catch (err) {
    return unexpected('GET /api/rounds/expenses', err);
  }
}

/** Type an expense in. A repeated clientMutationId is a replay (200, same id). */
export async function POST(request: Request) {
  const auth = await requireExpensesApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = addExpenseSchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  try {
    const result = await addExpenseCore(auth.ctx.supabase, {
      tenantId: auth.ctx.tenantId,
      userId: auth.ctx.userId,
      values: parsed.data,
    });
    if (!result.ok) {
      return roundsJson({ error: result.error }, result.error === NO_LONGER ? 404 : 503);
    }
    const replay = result.replay === true;
    return roundsJson({ expenseId: result.expenseId, replay }, replay ? 200 : 201);
  } catch (err) {
    return unexpected('POST /api/rounds/expenses', err);
  }
}
