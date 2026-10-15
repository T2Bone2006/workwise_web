'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { createAdminClient } from '@/lib/supabase/admin';
import { clearWorkerCash, markHandedOver, undoHandOver } from '@/lib/team/hand-in';
import { handOverSchema, undoHandOverSchema } from '@/lib/validations/team';

/** The owner's hand-in actions. Each starts with requireOwner(); voiding a held payment uses the existing void action. */

type Result = { ok: true; changed: number } | { ok: false; error: string };

function refresh() {
  revalidatePath('/team');
  revalidatePath('/team/cash');
  revalidatePath('/dashboard');
  revalidatePath('/payments');
}

export async function handOverAction(input: unknown): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = handOverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' };
  const db = createAdminClient();
  const result = parsed.data.workerId
    ? await clearWorkerCash(db, { tenantId: owner.tenantId, workerId: parsed.data.workerId, userId: owner.userId, handedOverOn: parsed.data.handedOverOn })
    : await markHandedOver(db, { tenantId: owner.tenantId, paymentIds: parsed.data.paymentIds ?? [], userId: owner.userId, handedOverOn: parsed.data.handedOverOn });
  if (result.ok) refresh();
  return result;
}

export async function undoHandOverAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = undoHandOverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Not found.' };
  const result = await undoHandOver(createAdminClient(), { tenantId: owner.tenantId, paymentId: parsed.data.paymentId });
  if (result.ok) refresh();
  return result;
}
