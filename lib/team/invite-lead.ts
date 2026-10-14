import type { SupabaseClient } from '@supabase/supabase-js';
import { teamPricePence, teamPriceSentence, type TeamInterval } from '@/lib/billing/rounds-team-core';
import { previewRoundsTeamCharge } from '@/lib/billing/rounds-team-preview';
import { reconcileRoundsTeamAfterChange } from '@/lib/billing/rounds-team';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { buildTeamInviteEmail } from '@/lib/emails/team-invite';
import { EMAIL_EXISTS_MESSAGE, isEmailExistsError } from '@/lib/invites/worker-invite';
import { FROM_EMAIL, resend } from '@/lib/resend';
import { createAdminClient } from '@/lib/supabase/admin';
import type { LeadInvite } from '@/lib/validations/team';

/**
 * Inviting a lead (D2, D15). Written for the owner of a Rounds business, after requireOwner(): the business and
 * the owner's id come from the session. A lead is an ordinary `employee` worker (login on the phone and the
 * /worker website area) plus a team_people row (day rate, usual days). It does NOT call the Pro invite code, so
 * it cannot change what a Pro business does, and it never asks for a postcode, skills or a worker type.
 *
 * Order matters because money is involved: the price is agreed first (nothing is created without it), both
 * rows are created together or neither stays, and the £10 line is added last.
 */

export type InviteLeadResult =
  | { ok: true; workerId: string; personId: string; emailSent: boolean }
  | { ok: false; error: string }
  | {
      ok: false;
      needsConfirm: { perLeadPence: number; interval: TeamInterval; chargeNowPence: number | null; sentence: string };
    };

const PRO_TIERS = ['starter', 'growth', 'pro'];
const INVITE_DAYS = 7;

export const NOT_ROUNDS_MESSAGE = 'Team members are for Rounds businesses.';
export const CANNOT_ADD_MESSAGE = "Your plan can't add team members yet. Contact us.";

type SubRow = { product: string; source: string; status: string; stripe_subscription_id: string | null; billing_interval: string | null };

/** The business must be Rounds, not Pro, and billed through Stripe (a hand-set-up account would get free staff). */
export async function checkPlan(
  db: SupabaseClient,
  tenantId: string,
): Promise<{ ok: true; interval: TeamInterval } | { ok: false; error: string }> {
  const { data, error } = await db
    .from('subscriptions')
    .select('product, source, status, stripe_subscription_id, billing_interval')
    .eq('tenant_id', tenantId)
    .in('status', [...ENTITLED_STATUSES]);
  if (error || !Array.isArray(data)) return { ok: false, error: 'Could not check your plan. Try again.' };
  const rows = data as SubRow[];
  if (rows.some((r) => PRO_TIERS.includes(r.product))) return { ok: false, error: NOT_ROUNDS_MESSAGE };
  const rounds = rows.find((r) => r.product === 'rounds' && r.source === 'stripe' && r.stripe_subscription_id);
  if (!rounds) {
    return { ok: false, error: rows.some((r) => r.product === 'rounds') ? CANNOT_ADD_MESSAGE : NOT_ROUNDS_MESSAGE };
  }
  return { ok: true, interval: rounds.billing_interval === 'year' ? 'year' : 'month' };
}

function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function confirmSentence(interval: TeamInterval, chargeNowPence: number | null): string {
  const base = `${teamPriceSentence(interval)}. You'll be charged from today`;
  return chargeNowPence != null && chargeNowPence > 0
    ? `${base}: ${pounds(chargeNowPence)} now for the rest of your year.`
    : `${base}.`;
}

async function businessName(db: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await db.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  const name = (data as { name?: string | null } | null)?.name?.trim();
  return name || 'Your employer';
}

async function sendInviteEmail(
  db: SupabaseClient,
  p: { tenantId: string; name: string; email: string; token: string },
): Promise<boolean> {
  try {
    const { subject, html } = buildTeamInviteEmail({
      businessName: await businessName(db, p.tenantId),
      leadName: p.name,
      inviteUrl: `https://app.joinworkwise.com/accept-invite?token=${p.token}`,
    });
    const { error } = await resend.emails.send({ from: FROM_EMAIL, to: p.email, subject, html });
    if (error) {
      console.error('[team] invite email', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[team] invite email', err instanceof Error ? err.message : err);
    return false;
  }
}

async function newInviteToken(
  db: SupabaseClient,
  p: { tenantId: string; workerId: string; email: string },
): Promise<string | null> {
  const token = crypto.randomUUID();
  const { error } = await db.from('worker_invites').insert({
    token,
    worker_id: p.workerId,
    tenant_id: p.tenantId,
    email: p.email,
    expires_at: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) {
    console.error('[team] worker_invites insert', error.message);
    return null;
  }
  return token;
}

export async function inviteLead(args: {
  tenantId: string;
  userId: string;
  input: LeadInvite;
  db?: SupabaseClient;
}): Promise<InviteLeadResult> {
  const db = args.db ?? createAdminClient();
  const { tenantId, userId, input } = args;

  const plan = await checkPlan(db, tenantId);
  if (!plan.ok) return plan;

  // 1. The price. Nothing is created until the owner has agreed to this exact figure.
  const preview = await previewRoundsTeamCharge(tenantId, 1, db);
  const interval: TeamInterval = preview.ok ? preview.interval : plan.interval;
  const perLeadPence = teamPricePence(interval);
  const chargeNowPence = preview.ok ? preview.chargeNowPence : null;
  if (input.confirmedPriceCents !== perLeadPence) {
    return {
      ok: false,
      needsConfirm: { perLeadPence, interval, chargeNowPence, sentence: confirmSentence(interval, chargeNowPence) },
    };
  }

  // 2. One person, one email.
  const email = input.email.trim().toLowerCase();
  const { data: existing, error: existingError } = await db
    .from('workers')
    .select('id')
    .eq('primary_tenant_id', tenantId)
    .eq('email', email)
    .maybeSingle();
  if (existingError) return { ok: false, error: 'Could not check that email. Try again.' };
  if (existing) return { ok: false, error: 'A team member with this email already exists.' };

  // 3. The login.
  const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { data: { full_name: input.name, primary_tenant_id: tenantId } },
  });
  if (linkError) {
    console.error('[team] generateLink', linkError.message);
    return { ok: false, error: isEmailExistsError(linkError) ? EMAIL_EXISTS_MESSAGE : "Couldn't send the invite. Try again." };
  }
  const authUserId = linkData?.user?.id ?? null;
  const undoLogin = async () => {
    if (!authUserId) return;
    const { error } = await db.auth.admin.deleteUser(authUserId);
    if (error) console.error('[team] rollback deleteUser', error.message);
  };

  // 4. The worker row and the team row, together or not at all.
  const now = new Date().toISOString();
  const { data: worker, error: workerError } = await db
    .from('workers')
    .insert({
      primary_tenant_id: tenantId,
      full_name: input.name,
      phone: input.phone,
      email,
      worker_type: 'employee',
      status: 'available',
      skills: [],
      invite_status: 'pending',
      user_id: authUserId,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (workerError || !worker) {
    console.error('[team] worker insert', workerError?.message);
    await undoLogin();
    return { ok: false, error: "Couldn't add them. Nothing was charged." };
  }
  const workerId = (worker as { id: string }).id;

  const undoWorker = async () => {
    await db.from('worker_tenants').delete().eq('worker_id', workerId);
    await db.from('worker_invites').delete().eq('worker_id', workerId);
    await db.from('workers').delete().eq('id', workerId);
    await undoLogin();
  };

  const { error: junctionError } = await db.from('worker_tenants').insert({
    worker_id: workerId,
    tenant_id: tenantId,
    status: 'active',
    is_primary: true,
    added_at: now,
    updated_at: now,
  });
  if (junctionError) console.error('[team] worker_tenants insert', junctionError.message);

  const { data: person, error: personError } = await db
    .from('team_people')
    .insert({
      tenant_id: tenantId,
      kind: 'lead',
      worker_id: workerId,
      name: input.name,
      day_rate_pence: input.dayRatePounds,
      usual_days: input.usualDays,
    })
    .select('id')
    .single();
  if (personError || !person) {
    console.error('[team] team_people insert', personError?.message);
    await undoWorker();
    return { ok: false, error: "Couldn't add them. Nothing was charged." };
  }
  const personId = (person as { id: string }).id;

  const token = await newInviteToken(db, { tenantId, workerId, email });
  if (!token) {
    await db.from('team_people').delete().eq('id', personId);
    await undoWorker();
    return { ok: false, error: "Couldn't add them. Nothing was charged." };
  }

  // 5. The record that the owner agreed to the price (a failure here never undoes the lead).
  const { data: leadRows } = await db
    .from('team_people')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('kind', 'lead')
    .is('ended_at', null);
  const { error: consentError } = await db.from('worker_allowance_confirmations').insert({
    tenant_id: tenantId,
    confirmed_by_user_id: userId,
    worker_id: workerId,
    tier: 'rounds',
    worker_number: Array.isArray(leadRows) ? leadRows.length : 1,
    included_workers: 0,
    extra_worker_pounds: perLeadPence / 100,
  });
  if (consentError) console.error('[team] consent record', consentError.message);

  // 6. The email, then the charge. A failed email leaves them on the team (and charged) so the owner can resend.
  const emailSent = await sendInviteEmail(db, { tenantId, name: input.name, email, token });
  reconcileRoundsTeamAfterChange(tenantId);
  return { ok: true, workerId, personId, emailSent };
}

export async function resendLeadInvite(args: {
  tenantId: string;
  personId: string;
  db?: SupabaseClient;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = args.db ?? createAdminClient();
  const { data: person } = await db
    .from('team_people')
    .select('id, kind, name, worker_id, ended_at')
    .eq('id', args.personId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle();
  const row = person as { kind: string; name: string; worker_id: string | null; ended_at: string | null } | null;
  if (!row || row.kind !== 'lead' || !row.worker_id) return { ok: false, error: 'Not found.' };
  if (row.ended_at) return { ok: false, error: "They've been removed." };

  const { data: worker } = await db
    .from('workers')
    .select('id, email, invite_status')
    .eq('id', row.worker_id)
    .eq('primary_tenant_id', args.tenantId)
    .maybeSingle();
  const w = worker as { id: string; email: string | null; invite_status: string | null } | null;
  if (!w) return { ok: false, error: 'Not found.' };
  if (w.invite_status === 'deactivated') return { ok: false, error: "They've been removed." };
  if (w.invite_status === 'accepted') return { ok: false, error: "They've already joined." };
  if (!w.email) return { ok: false, error: 'They have no email address.' };

  const token = await newInviteToken(db, { tenantId: args.tenantId, workerId: w.id, email: w.email });
  if (!token) return { ok: false, error: "Couldn't send the invite. Try again." };
  const sent = await sendInviteEmail(db, { tenantId: args.tenantId, name: row.name, email: w.email, token });
  return sent ? { ok: true } : { ok: false, error: "The email didn't send. Try again." };
}
