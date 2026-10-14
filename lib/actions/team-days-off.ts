'use server';

import { revalidatePath } from 'next/cache';
import { actorForUser } from '@/lib/api/rounds-request';
import { requireOwner } from '@/lib/auth/require-owner';
import { notifyVisitChange, type NoticeCounts } from '@/lib/messaging/visit-change-notices';
import { previewPushBack, pushBackWithLog } from '@/lib/rounds/push-back-core';
import { createAdminClient } from '@/lib/supabase/admin';
import { addDayOff } from '@/lib/team/team-core';
import { findStopsOnDaysOff, type StopsOnDayOff } from '@/lib/team/days-off';
import { pushBackSchema } from '@/lib/validations/rounds/visit';
import { dayOffSchema } from '@/lib/validations/team';

/** Days off and Push back for the web dashboard. Every action starts with requireOwner(). */

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? 'Check the details and try again.';
}

export async function addDayOffAndMaybePushBack(
  input: unknown,
): Promise<{ ok: true; id: string; alreadySaved: boolean; stops: StopsOnDayOff[] } | { ok: false; error: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = dayOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const db = createAdminClient();
  const saved = await addDayOff(db, owner.tenantId, parsed.data);
  if (!saved.ok) return saved;
  const stops = await findStopsOnDaysOff(db, owner.tenantId, parsed.data.from, parsed.data.to);
  revalidatePath('/calendar');
  revalidatePath('/team');
  return { ok: true, id: saved.id, alreadySaved: saved.alreadySaved, stops };
}

export async function previewPushBackAction(input: unknown) {
  const owner = await requireOwner();
  if (!owner.ok) return { success: false as const, error: owner.error };
  const parsed = pushBackSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: firstIssue(parsed.error) };
  const result = await previewPushBack(createAdminClient(), {
    tenantId: owner.tenantId,
    workerId: parsed.data.workerId,
    offFrom: parsed.data.offFrom,
    offTo: parsed.data.offTo,
  });
  if (!result.success) return result;
  return {
    success: true as const,
    moves: result.plan.moves.length,
    stuck: result.plan.stuck.length,
    lastDate: result.lastDate,
    firstMoves: result.sample,
  };
}

export async function pushBackAction(
  input: unknown,
): Promise<
  | { success: true; moved: number; stuck: number; changeId: string | null; notified?: NoticeCounts }
  | { success: false; error: string }
> {
  const owner = await requireOwner();
  if (!owner.ok) return { success: false, error: owner.error };
  const parsed = pushBackSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  const notify = parsed.data.notifyCustomers ?? false;
  const actor = await actorForUser(owner.supabase, owner.userId);
  const result = await pushBackWithLog(createAdminClient(), {
    tenantId: owner.tenantId,
    workerId: parsed.data.workerId,
    offFrom: parsed.data.offFrom,
    offTo: parsed.data.offTo,
    actor,
    notifyCustomers: notify,
  });
  if (!result.success) return result;
  let notified: NoticeCounts | undefined;
  if (result.changeId && notify) {
    try {
      notified = await notifyVisitChange({ tenantId: owner.tenantId, changeId: result.changeId });
    } catch (err) {
      console.error('[team/push-back] notify', err instanceof Error ? err.name : 'error');
    }
  }
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  return { success: true, moved: result.moved, stuck: result.stuck, changeId: result.changeId, notified };
}
