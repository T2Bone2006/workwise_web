'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { createAdminClient } from '@/lib/supabase/admin';
import { addWorkDay, recordTeamPayment, removeWorkDay, updateWorkDay, voidTeamPayment } from '@/lib/team/pay';
import { editDaySchema, teamPaymentSchema, workDaySchema } from '@/lib/validations/team';

/** The owner's pay actions. Each starts with requireOwner() (staff are refused) and takes the business from the session. */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? 'Check the details and try again.';
}

function refresh() {
  revalidatePath('/team');
  revalidatePath('/team/pay');
  revalidatePath('/expenses');
  revalidatePath('/dashboard');
}

export async function recordPaymentAction(input: unknown): Promise<Result<{ paymentId: string }>> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = teamPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const result = await recordTeamPayment(createAdminClient(), {
    tenantId: owner.tenantId,
    userId: owner.userId,
    personId: parsed.data.personId,
    amountPence: parsed.data.amount,
    paidOn: parsed.data.paidOn,
    note: parsed.data.note,
    clientMutationId: parsed.data.clientMutationId,
  });
  if (result.ok) refresh();
  return result;
}

export async function voidPaymentAction(paymentId: string): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return { ok: false, error: 'Not found.' };
  const result = await voidTeamPayment(createAdminClient(), { tenantId: owner.tenantId, userId: owner.userId, paymentId });
  if (result.ok) refresh();
  return result;
}

export async function addDayAction(input: unknown): Promise<Result<{ id: string }>> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = workDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const result = await addWorkDay(createAdminClient(), {
    tenantId: owner.tenantId,
    personId: parsed.data.personId,
    date: parsed.data.date,
    ratePence: parsed.data.ratePounds,
    note: parsed.data.note,
  });
  if (result.ok) refresh();
  return result;
}

export async function editDayAction(input: unknown): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = editDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const result = await updateWorkDay(createAdminClient(), {
    tenantId: owner.tenantId,
    id: parsed.data.id,
    ratePence: parsed.data.ratePounds,
    note: parsed.data.note,
  });
  if (result.ok) refresh();
  return result;
}

export async function removeDayAction(id: string): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Not found.' };
  const result = await removeWorkDay(createAdminClient(), { tenantId: owner.tenantId, id });
  if (result.ok) refresh();
  return result;
}
