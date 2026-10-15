import type { SupabaseClient } from '@supabase/supabase-js';
import { roundMoney } from '@/lib/money/pence';
import type { MoneyResult } from '@/lib/payments/money-core';
import { todayInLondon } from '@/lib/rounds/dates';

/** Description used for the add-customer form's "Owes from before" (D12). */
export const STARTING_BALANCE_DESCRIPTION = 'Owed from before WorkWise';

const OWNER_ONLY = 'Only the account owner can change this.';

/** RLS refusals: 42501 on insert; the admin-only policies are the only gate. */
function isRlsRefusal(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42501' ||
    (error.message ?? '').includes('row-level security')
  );
}

/** Data (22…) and constraint (23…) errors won't change on a retry; anything else might. */
function isRetryableDbError(error: { code?: string }): boolean {
  const code = error.code ?? '';
  return !code.startsWith('22') && !code.startsWith('23');
}

/**
 * Adds an "other amount owed" to a customer with the caller's RLS client
 * (admin only). The customer_charges trigger re-runs the money engine, so
 * existing credit pays it at once — this never allocates.
 */
export async function addChargeCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    customerId: string;
    description: string;
    amount: number;
    chargeDate: string;
    kind: 'starting_balance' | 'other';
    userId: string | null;
  },
): Promise<MoneyResult<{ chargeId: string }>> {
  const description = p.description.trim().slice(0, 120);
  if (description === '') {
    return { success: false, error: 'Add a short description.' };
  }
  const amount = Number.isFinite(p.amount) ? roundMoney(p.amount) : 0;
  if (amount <= 0) {
    return { success: false, error: 'Enter an amount over £0.' };
  }
  if (amount > 100_000) {
    return { success: false, error: 'Enter an amount up to £100,000.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.chargeDate)) {
    return { success: false, error: 'Enter a date.' };
  }
  if (p.chargeDate > todayInLondon()) {
    return { success: false, error: "The date can't be in the future." };
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  if (customerError) {
    console.error('addChargeCore customer lookup failed', customerError);
    return { success: false, error: 'Could not save the amount owed.', retryable: true };
  }
  if (!customer) {
    return { success: false, error: 'Customer not found.' };
  }

  const { data, error } = await supabase
    .from('customer_charges')
    .insert({
      tenant_id: p.tenantId,
      customer_id: p.customerId,
      kind: p.kind,
      description,
      amount,
      charge_date: p.chargeDate,
      created_by_user_id: p.userId,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if (isRlsRefusal(error)) {
      return { success: false, error: OWNER_ONLY };
    }
    console.error('addChargeCore insert failed', error);
    return {
      success: false,
      error: 'Could not save the amount owed.',
      retryable: isRetryableDbError(error),
    };
  }

  const id =
    data && typeof (data as { id?: unknown }).id === 'string'
      ? (data as { id: string }).id
      : null;
  if (!id) {
    return { success: false, error: 'Could not save the amount owed.', retryable: true };
  }
  return { success: true, chargeId: id };
}

/**
 * Voids an active charge (never deleted). Already void → success. The trigger
 * moves any money that paid it to the next owed item or back to credit.
 */
export async function voidChargeCore(
  supabase: SupabaseClient,
  p: { tenantId: string; chargeId: string; userId: string | null },
): Promise<MoneyResult> {
  const { data, error } = await supabase
    .from('customer_charges')
    .select('id, status')
    .eq('id', p.chargeId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  if (error) {
    console.error('voidChargeCore lookup failed', error);
    return { success: false, error: 'Could not remove the amount owed.', retryable: true };
  }
  if (!data) {
    return { success: false, error: 'Amount owed not found.' };
  }
  if ((data as { status?: unknown }).status === 'void') {
    return { success: true };
  }

  const { data: updated, error: updateError } = await supabase
    .from('customer_charges')
    .update({
      status: 'void',
      voided_at: new Date().toISOString(),
      voided_by_user_id: p.userId,
    })
    .eq('id', p.chargeId)
    .eq('tenant_id', p.tenantId)
    .eq('status', 'active')
    .select('id');

  if (updateError) {
    if (isRlsRefusal(updateError)) {
      return { success: false, error: OWNER_ONLY };
    }
    console.error('voidChargeCore update failed', updateError);
    return {
      success: false,
      error: 'Could not remove the amount owed.',
      retryable: isRetryableDbError(updateError),
    };
  }
  if (Array.isArray(updated) && updated.length > 0) {
    return { success: true };
  }

  // No row changed: either someone voided it first, or RLS hid the update
  // (a worker login — the update policy is admin only).
  const { data: again } = await supabase
    .from('customer_charges')
    .select('status')
    .eq('id', p.chargeId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if ((again as { status?: unknown } | null)?.status === 'void') {
    return { success: true };
  }
  return { success: false, error: OWNER_ONLY };
}
