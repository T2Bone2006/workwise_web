'use server';

import { revalidatePath } from 'next/cache';
import { actorForUser } from '@/lib/api/rounds-request';
import { requireOwner } from '@/lib/auth/require-owner';
import { createAdminClient } from '@/lib/supabase/admin';
import { giveRoundOnDay, reassignVisits, setUsualLead, type AssignResult } from '@/lib/team/assign';
import {
  giveRoundSchema,
  reassignVisitsSchema,
  setUsualLeadSchema,
} from '@/lib/validations/rounds/visit';

/** The owner's "give this to someone" and "who usually does this round" actions. Each starts with requireOwner(). */

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? 'Check the details and try again.';
}

function refresh() {
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  revalidatePath('/team');
}

export async function reassignVisitsAction(input: unknown): Promise<AssignResult> {
  const owner = await requireOwner();
  if (!owner.ok) return { success: false, error: owner.error };
  const parsed = reassignVisitsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  const actor = await actorForUser(owner.supabase, owner.userId);
  const result = await reassignVisits(createAdminClient(), {
    tenantId: owner.tenantId,
    jobIds: parsed.data.jobIds,
    toWorkerId: parsed.data.toWorkerId,
    actor,
  });
  if (result.success) refresh();
  return result;
}

export async function giveRoundAction(input: unknown): Promise<AssignResult> {
  const owner = await requireOwner();
  if (!owner.ok) return { success: false, error: owner.error };
  const parsed = giveRoundSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  const actor = await actorForUser(owner.supabase, owner.userId);
  const result = await giveRoundOnDay(createAdminClient(), {
    tenantId: owner.tenantId,
    date: parsed.data.date,
    fromWorkerId: parsed.data.fromWorkerId,
    toWorkerId: parsed.data.toWorkerId,
    roundId: parsed.data.roundId ?? null,
    actor,
  });
  if (result.success) refresh();
  return result;
}

export async function setUsualLeadAction(
  input: unknown,
): Promise<{ success: true; repointed: number } | { success: false; error: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { success: false, error: owner.error };
  const parsed = setUsualLeadSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  const result = await setUsualLead(createAdminClient(), {
    tenantId: owner.tenantId,
    roundId: parsed.data.roundId,
    workerId: parsed.data.workerId,
  });
  if (result.success) {
    refresh();
    revalidatePath('/map');
  }
  return result;
}
