'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  addDayOff,
  addHelper,
  endHelper,
  removeDayOff,
  removeLead,
  setDayRate,
  setUsualDays,
  updatePerson,
  type RemoveLeadResult,
} from '@/lib/team/team-core';
import type { TeamResult } from '@/lib/team/types';
import { inviteLead, resendLeadInvite, type InviteLeadResult } from '@/lib/team/invite-lead';
import {
  dayOffSchema,
  helperSchema,
  leadInviteSchema,
  personUsualDaysSchema,
  rateSchema,
} from '@/lib/validations/team';

/**
 * The owner's team actions. Each starts with requireOwner() (a member of staff is refused), validates the input,
 * then runs the core with the service-role client and the business taken from the session, never from the form.
 */

const idSchema = (value: unknown): string | null =>
  typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? 'Check the details and try again.';
}

function done<T extends TeamResult>(result: T): T {
  if (result.ok) revalidatePath('/team');
  return result;
}

export async function addHelperAction(input: unknown): Promise<TeamResult<{ id: string }>> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = helperSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return done(
    await addHelper(createAdminClient(), owner.tenantId, {
      name: parsed.data.name,
      dayRatePence: parsed.data.dayRatePounds,
      usualDays: parsed.data.usualDays,
    }),
  );
}

export async function renamePersonAction(personId: string, name: string): Promise<TeamResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const id = idSchema(personId);
  if (!id) return { ok: false, error: 'Not found.' };
  return done(await updatePerson(createAdminClient(), owner.tenantId, id, { name }));
}

export async function setDayRateAction(input: unknown): Promise<TeamResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return done(await setDayRate(createAdminClient(), owner.tenantId, parsed.data.personId, parsed.data.dayRatePounds));
}

export async function setUsualDaysAction(input: unknown): Promise<TeamResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = personUsualDaysSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return done(await setUsualDays(createAdminClient(), owner.tenantId, parsed.data.personId, parsed.data.usualDays));
}

export async function endHelperAction(personId: string): Promise<TeamResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const id = idSchema(personId);
  if (!id) return { ok: false, error: 'Not found.' };
  return done(await endHelper(createAdminClient(), owner.tenantId, id));
}

export async function removeLeadAction(personId: string): Promise<TeamResult<RemoveLeadResult>> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const id = idSchema(personId);
  if (!id) return { ok: false, error: 'Not found.' };
  const result = await removeLead(createAdminClient(), owner.tenantId, id);
  if (result.ok) {
    revalidatePath('/team');
    revalidatePath('/calendar');
    revalidatePath('/dashboard');
  }
  return result;
}

export async function addDayOffAction(input: unknown): Promise<TeamResult<{ id: string; alreadySaved: boolean }>> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = dayOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const result = await addDayOff(createAdminClient(), owner.tenantId, parsed.data);
  if (result.ok) revalidatePath('/calendar');
  return done(result);
}

export async function removeDayOffAction(id: string): Promise<TeamResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const clean = idSchema(id);
  if (!clean) return { ok: false, error: 'Not found.' };
  const result = await removeDayOff(createAdminClient(), owner.tenantId, clean);
  if (result.ok) revalidatePath('/calendar');
  return done(result);
}

/**
 * Add a lead. The first call (without confirmedPriceCents) only asks: it returns { needsConfirm } with the exact
 * price sentence and creates nothing. The call with the agreed figure creates the lead and starts the charge.
 */
export async function inviteLeadAction(input: unknown): Promise<InviteLeadResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const parsed = leadInviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const result = await inviteLead({ tenantId: owner.tenantId, userId: owner.userId, input: parsed.data });
  if (result.ok) revalidatePath('/team');
  return result;
}

export async function resendLeadInviteAction(personId: string): Promise<TeamResult> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const id = idSchema(personId);
  if (!id) return { ok: false, error: 'Not found.' };
  const result = await resendLeadInvite({ tenantId: owner.tenantId, personId: id });
  return result.ok ? { ok: true } : result;
}
