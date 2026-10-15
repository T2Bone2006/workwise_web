import { parseUuidParam, unexpected } from '@/lib/api/direct-debit-request';
import { requireExpensesApi } from '@/lib/api/expenses-request';
import { firstZodError, readJsonBody, roundsJson } from '@/lib/api/rounds-request';
import { getExpense } from '@/lib/data/expenses';
import { deleteExpenseCore, saveExpenseCore } from '@/lib/expenses/expenses-core';
import { saveExpenseSchema } from '@/lib/validations/expenses';

export const runtime = 'nodejs';

const NO_LONGER = 'This expense no longer exists.';

function coreFailure(error: string) {
  return roundsJson({ error }, error === NO_LONGER ? 404 : 503);
}

/** One expense, draft or saved. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireExpensesApi(request);
  if (!auth.ok) return auth.response;
  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;

  try {
    const row = await getExpense(auth.ctx.supabase, auth.ctx.tenantId, id.id);
    if (!row) return roundsJson({ error: NO_LONGER }, 404);
    return roundsJson(row);
  } catch (err) {
    return unexpected('GET /api/rounds/expenses/[id]', err);
  }
}

/** Save a To check draft, or edit a saved expense. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireExpensesApi(request);
  if (!auth.ok) return auth.response;
  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = saveExpenseSchema.safeParse({ ...json.body, expenseId: id.id });
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  try {
    const result = await saveExpenseCore(auth.ctx.supabase, {
      tenantId: auth.ctx.tenantId,
      values: parsed.data,
    });
    if (!result.ok) return coreFailure(result.error);
    return roundsJson({ ok: true });
  } catch (err) {
    return unexpected('PATCH /api/rounds/expenses/[id]', err);
  }
}

/** Delete an expense and its photo. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireExpensesApi(request);
  if (!auth.ok) return auth.response;
  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;

  try {
    const result = await deleteExpenseCore(auth.ctx.supabase, auth.ctx.admin, {
      tenantId: auth.ctx.tenantId,
      expenseId: id.id,
    });
    if (!result.ok) return coreFailure(result.error);
    return roundsJson({ ok: true });
  } catch (err) {
    return unexpected('DELETE /api/rounds/expenses/[id]', err);
  }
}
