'use server';

import { revalidatePath } from 'next/cache';
import {
  decideBooking,
  setBookedFor,
  setLeadStatus,
} from '@/lib/lite/leads-core';
import { requireLite } from '@/lib/lite/require-lite';
import { litePaths } from '@/lib/navigation/lite-paths';
import { createAdminClient } from '@/lib/supabase/admin';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/validations/lite/lead';

type ActionResult = { success: true } | { success: false; error: string };

const ERRORS: Record<string, string> = {
  not_found: 'That lead could not be found.',
  not_requested: 'That booking has already been decided.',
  decide_first: 'Accept or decline the booking first.',
  bad_amount: 'Enter a price between £1 and £50,000.',
  not_firm: 'Change price is only for a firm quote.',
  not_won: 'Set a date once the lead is won.',
  bad_date: 'Pick a date within the next year.',
  save_failed: "Couldn't save that. Try again.",
};

function fail(error: string): ActionResult {
  return { success: false, error: ERRORS[error] ?? "Couldn't save that. Try again." };
}

function refresh(leadId: string): void {
  revalidatePath('/lite');
  revalidatePath(litePaths.lead(leadId));
}

export async function acceptBookingAction(leadId: string): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const result = await decideBooking(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    leadId,
    by: 'owner',
    decision: 'accept',
  });
  if (!result.ok) return fail(result.error);
  refresh(leadId);
  return { success: true };
}

export async function declineBookingAction(leadId: string, tellCustomer: boolean): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const result = await decideBooking(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    leadId,
    by: 'owner',
    decision: 'decline',
    tellCustomer,
  });
  if (!result.ok) return fail(result.error);
  refresh(leadId);
  return { success: true };
}

export async function changePriceAction(leadId: string, amount: number): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const result = await decideBooking(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    leadId,
    by: 'owner',
    decision: 'change_price',
    newAmount: amount,
  });
  if (!result.ok) return fail(result.error);
  refresh(leadId);
  return { success: true };
}

export async function setLeadStatusAction(leadId: string, status: LeadStatus): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    return { success: false, error: 'Accept or decline the booking first.' };
  }
  const result = await setLeadStatus(createAdminClient(), { tenantId: auth.ctx.tenantId, leadId, status });
  if (!result.ok) return fail(result.error);
  refresh(leadId);
  return { success: true };
}

export async function setBookedForAction(
  leadId: string,
  date: string | null,
  time: string | null,
): Promise<ActionResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const result = await setBookedFor(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    leadId,
    date,
    time,
  });
  if (!result.ok) return fail(result.error);
  refresh(leadId);
  return { success: true };
}
