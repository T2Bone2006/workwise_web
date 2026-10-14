import type { SupabaseClient } from '@supabase/supabase-js';

export const TEAM_PAY_EXPENSE_MESSAGE = 'This is a payment to your team. Change it on the Team page.';

/**
 * True when this expense is the wages line made by recording a payment to a team member. Those lines are changed on the
 * Team page (void the payment), never on the Expenses page, or the pay log and the books would drift apart.
 * Never throws: if the question cannot be answered (for example before the Phase 9 migration is pasted) the answer is
 * "no", so ordinary expenses are never blocked by a read problem.
 */
export async function expenseIsTeamPay(db: SupabaseClient, tenantId: string, expenseId: string): Promise<boolean> {
  try {
    const { data, error } = await db
      .from('team_payments')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('expense_id', expenseId)
      .is('voided_at', null)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Which of these expenses are wages lines made by a team payment. Used to mark them in the Expenses list.
 * Never throws: an unreadable answer is "none are", so the list always shows.
 */
export async function teamPayExpenseIds(db: SupabaseClient, tenantId: string, expenseIds: string[]): Promise<Set<string>> {
  if (expenseIds.length === 0) return new Set();
  try {
    const { data, error } = await db
      .from('team_payments')
      .select('expense_id')
      .eq('tenant_id', tenantId)
      .is('voided_at', null)
      .in('expense_id', expenseIds);
    if (error || !Array.isArray(data)) return new Set();
    return new Set((data as Array<{ expense_id: string | null }>).map((r) => r.expense_id).filter((id): id is string => Boolean(id)));
  } catch {
    return new Set();
  }
}
