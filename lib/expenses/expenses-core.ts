import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { RECEIPT_BUCKET } from '@/lib/expenses/read-receipt';
import { roundMoney } from '@/lib/money/pence';
import type { AddExpense, SaveExpense } from '@/lib/validations/expenses';

export type ExpenseCoreResult =
  | { ok: true; expenseId: string; replay?: boolean }
  | { ok: false; error: string };

export const SAVE_FAILED = "Couldn't save that. Try again.";
export const NO_LONGER_EXISTS = 'This expense no longer exists.';
const SIGNED_URL_SECONDS = 300;

function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function fieldsFor(v: AddExpense | SaveExpense) {
  return {
    spent_on: v.spentOn,
    merchant: emptyToNull(v.merchant),
    category: v.category,
    amount: roundMoney(v.amount),
    vat_amount: v.vatAmount == null ? null : roundMoney(v.vatAmount),
    note: emptyToNull(v.note),
  };
}

/** Typing an expense in: counted straight away (T1). A replay returns the existing row (T4). */
export async function addExpenseCore(
  db: SupabaseClient,
  p: { tenantId: string; userId: string | null; values: AddExpense },
): Promise<ExpenseCoreResult> {
  const expenseId = crypto.randomUUID();
  const { error } = await db.from('expenses').insert({
    id: expenseId,
    tenant_id: p.tenantId,
    ...fieldsFor(p.values),
    status: 'confirmed',
    source: 'manual',
    confirmed_at: new Date().toISOString(),
    client_mutation_id: p.values.clientMutationId,
    created_by_user_id: p.userId,
  });
  if (!error) return { ok: true, expenseId };

  if (error.code === '23505') {
    const { data } = await db
      .from('expenses')
      .select('id')
      .eq('tenant_id', p.tenantId)
      .eq('client_mutation_id', p.values.clientMutationId)
      .maybeSingle();
    if (data?.id) return { ok: true, expenseId: data.id as string, replay: true };
  }
  console.error('[addExpenseCore] insert failed', { code: error.code });
  return { ok: false, error: SAVE_FAILED };
}

/** Save on a To check draft confirms it; on a confirmed one it is an edit. Saving twice is harmless. */
export async function saveExpenseCore(
  db: SupabaseClient,
  p: { tenantId: string; values: SaveExpense },
): Promise<ExpenseCoreResult> {
  const { data: existing, error: readError } = await db
    .from('expenses')
    .select('id, confirmed_at')
    .eq('id', p.values.expenseId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (readError) return { ok: false, error: SAVE_FAILED };
  if (!existing) return { ok: false, error: NO_LONGER_EXISTS };

  const { data, error } = await db
    .from('expenses')
    .update({
      ...fieldsFor(p.values),
      status: 'confirmed',
      confirmed_at: (existing.confirmed_at as string | null) ?? new Date().toISOString(),
    })
    .eq('id', p.values.expenseId)
    .eq('tenant_id', p.tenantId)
    .select('id');
  if (error) {
    console.error('[saveExpenseCore] update failed', { code: error.code });
    return { ok: false, error: SAVE_FAILED };
  }
  if (!data || data.length === 0) return { ok: false, error: NO_LONGER_EXISTS };
  return { ok: true, expenseId: p.values.expenseId };
}

/**
 * The row goes first (RLS client). Only then is the photo removed (admin
 * client): an orphan photo is harmless, a lost row is not.
 */
export async function deleteExpenseCore(
  db: SupabaseClient,
  admin: SupabaseClient,
  p: { tenantId: string; expenseId: string },
): Promise<ExpenseCoreResult> {
  const { data, error } = await db
    .from('expenses')
    .delete()
    .eq('id', p.expenseId)
    .eq('tenant_id', p.tenantId)
    .select('receipt_path');
  if (error) {
    console.error('[deleteExpenseCore] delete failed', { code: error.code });
    return { ok: false, error: SAVE_FAILED };
  }
  if (!data || data.length === 0) return { ok: false, error: NO_LONGER_EXISTS };

  const receiptPath = (data[0] as { receipt_path: string | null }).receipt_path;
  if (receiptPath) {
    try {
      const { error: removeError } = await admin.storage.from(RECEIPT_BUCKET).remove([receiptPath]);
      if (removeError) console.error('[deleteExpenseCore] photo not removed', { expenseId: p.expenseId });
    } catch {
      console.error('[deleteExpenseCore] photo not removed', { expenseId: p.expenseId });
    }
  }
  return { ok: true, expenseId: p.expenseId };
}

/** A 5-minute link to one receipt photo, only if the expense belongs to this business. */
export async function receiptSignedUrl(
  admin: SupabaseClient,
  p: { tenantId: string; expenseId: string },
): Promise<string | null> {
  const { data } = await admin
    .from('expenses')
    .select('receipt_path')
    .eq('id', p.expenseId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  const path = (data as { receipt_path: string | null } | null)?.receipt_path;
  if (!path) return null;
  const { data: signed, error } = await admin.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !signed?.signedUrl) return null;
  return signed.signedUrl;
}
