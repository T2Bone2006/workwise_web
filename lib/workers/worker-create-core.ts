import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { workerSchema } from '@/lib/validations/worker';
import { inviteWorkerPayloadSchema } from '@/lib/validations/worker-invite';
import { buildWorkerInviteEmail } from '@/lib/emails/worker-invite';
import { buildWorkerBusinessInviteEmail } from '@/lib/emails/worker-business-invite';
import { EMAIL_EXISTS_MESSAGE, inviteKindFor, isEmailExistsError } from '@/lib/invites/worker-invite';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { postcodeToLatLng } from '@/lib/utils/postcode';
import { loadWorkerAllowance, recordExtraWorkerConsent } from '@/lib/data/worker-allowance';
import { reconcileExtraWorkersAfterChange } from '@/lib/billing/extra-workers';
import { noticeForNextWorker, noticeSentence, type ExtraWorkerNotice } from '@/lib/billing/pro-allowance';
import { previewExtraWorkerCharge } from '@/lib/billing/extra-workers-preview';

/**
 * Adding one worker: the bodies of the createWorker and inviteWorker server actions, moved here unchanged so that
 * bulk add can reuse them. The actions call these with no options, which is exactly today's behaviour.
 */
export type WorkerCoreOptions = {
  /** 'check' = today's behaviour (refuse until the owner confirms an extra worker); 'skip' = the caller already checked and confirmed. */
  allowance?: 'check' | 'skip';
  /** 'after' = today's behaviour (reconcile Stripe after the response); 'skip' = the caller reconciles once at the end. */
  reconcile?: 'after' | 'skip';
  /** false = don't write a consent row (bulk writes one for the whole batch). Default true. */
  recordConsent?: boolean;
  /** false = create the worker and the invite token but do NOT send the invite email (bulk sends them in one batch). Default true. */
  sendEmail?: boolean;
};

export type CreateWorkerResult =
  | { success: true; workerId: string }
  | { success: false; error: string; needsExtraWorkerConfirm?: ExtraWorkerNotice };

export type InviteWorkerResult =
  | { success: true; workerId: string; inviteToken: string | null }
  | { success: false; error: string; needsExtraWorkerConfirm?: ExtraWorkerNotice };

/**
 * Stripe knows whether this business pays monthly or yearly and, for yearly, exactly what adding one worker charges
 * today. The notice shown to the owner (and recorded as their agreement) uses that when it is available; if Stripe
 * can't be asked, the notice stays as our own records describe it and the worker can still be added.
 */
async function withPreview(notice: ExtraWorkerNotice, tenantId: string): Promise<ExtraWorkerNotice> {
  try {
    const preview = await previewExtraWorkerCharge(tenantId, 1);
    if (!preview.ok) return notice;
    return {
      ...notice,
      interval: preview.interval,
      perWorkerPence: preview.perWorkerPence,
      chargeNowPence: preview.chargeNowPence,
    };
  } catch {
    return notice;
  }
}

function getRawFormData(formData: FormData) {
  return {
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
    email: formData.get('email') ?? '',
    home_postcode: formData.get('home_postcode'),
    worker_type: formData.get('worker_type'),
    status: formData.get('status'),
    skills: formData.get('skills'),
  };
}

export async function createWorkerCore(formData: FormData, opts: WorkerCoreOptions = {}): Promise<CreateWorkerResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!userData?.tenant_id) {
    return { success: false, error: 'No tenant found' };
  }

  const rawData = getRawFormData(formData);
  const skillsRaw = rawData.skills;
  const skills =
    typeof skillsRaw === 'string'
      ? (JSON.parse(skillsRaw || '[]') as string[])
      : [];

  const validated = workerSchema.parse({
    ...rawData,
    skills,
  });

  const coords = await postcodeToLatLng(validated.home_postcode);
  if (!coords) {
    return {
      success: false,
      error: 'Invalid postcode - could not find coordinates',
    };
  }

  // Past the plan's included workers? The account holder must agree to the extra-worker price first.
  const allowance = opts.allowance === 'skip' ? null : await loadWorkerAllowance(userData.tenant_id);
  const baseNotice = allowance ? noticeForNextWorker(allowance) : null;
  const extraNotice = baseNotice ? await withPreview(baseNotice, userData.tenant_id) : null;
  if (extraNotice && formData.get('confirm_extra_worker') !== 'true') {
    return {
      success: false,
      error: noticeSentence(extraNotice),
      needsExtraWorkerConfirm: extraNotice,
    };
  }

  const { data: inserted, error } = await supabase
    .from('workers')
    .insert({
      primary_tenant_id: userData.tenant_id,
      full_name: validated.full_name,
      phone: validated.phone,
      email: validated.email || null,
      home_postcode: validated.home_postcode,
      home_lat: coords.lat,
      home_lng: coords.lng,
      worker_type: validated.worker_type,
      status: validated.status,
      skills: validated.skills,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !inserted) {
    console.error('Create worker error:', error);
    return { success: false, error: error?.message ?? 'Failed to create worker record' };
  }

  const tenantId = userData.tenant_id;
  const { error: junctionError } = await supabase.from('worker_tenants').insert({
    worker_id: inserted.id,
    tenant_id: tenantId,
    status: 'active',
    is_primary: true,
    added_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (junctionError) {
    console.error('[createWorker] worker_tenants insert:', junctionError);
  }

  if (extraNotice && opts.recordConsent !== false) {
    await recordExtraWorkerConsent({
      tenantId,
      userId: user.id,
      workerId: inserted.id,
      notice: extraNotice,
    });
  }

  // Keep the subscription's extra-worker line equal to the count (Stripe-billed Pro businesses only).
  if (opts.reconcile !== 'skip') reconcileExtraWorkersAfterChange(tenantId);

  return { success: true, workerId: inserted.id };
}

export async function inviteWorkerCore(formData: FormData, opts: WorkerCoreOptions = {}): Promise<InviteWorkerResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!userData?.tenant_id) {
    return { success: false, error: 'No tenant found' };
  }

  const rawData = getRawFormData(formData);
  let skills: string[];
  try {
    const skillsRaw = rawData.skills;
    skills =
      typeof skillsRaw === 'string'
        ? (JSON.parse(skillsRaw || '[]') as string[])
        : [];
  } catch {
    return { success: false, error: 'Invalid skills data' };
  }

  const parsed = inviteWorkerPayloadSchema.safeParse({
    full_name: typeof rawData.full_name === 'string' ? rawData.full_name : '',
    phone: typeof rawData.phone === 'string' ? rawData.phone : '',
    email: typeof rawData.email === 'string' ? rawData.email : '',
    home_postcode:
      typeof rawData.home_postcode === 'string' ? rawData.home_postcode : '',
    worker_type: rawData.worker_type,
    status: rawData.status,
    skills,
  });

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    const message =
      fe.full_name?.[0] ||
      fe.phone?.[0] ||
      fe.email?.[0] ||
      fe.home_postcode?.[0] ||
      fe.worker_type?.[0] ||
      fe.status?.[0] ||
      fe.skills?.[0] ||
      parsed.error.message;
    return { success: false, error: message ?? 'Validation failed' };
  }

  const coords = await postcodeToLatLng(parsed.data.home_postcode);
  if (!coords) {
    return {
      success: false,
      error: 'Invalid postcode - could not find coordinates',
    };
  }

  const emailNorm = parsed.data.email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from('workers')
    .select('id')
    .eq('primary_tenant_id', userData.tenant_id)
    .eq('email', emailNorm)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: 'A worker with this email already exists for your company.',
    };
  }

  // Past the plan's included workers? The account holder must agree to the extra-worker price first.
  const allowance = opts.allowance === 'skip' ? null : await loadWorkerAllowance(userData.tenant_id);
  const baseNotice = allowance ? noticeForNextWorker(allowance) : null;
  const extraNotice = baseNotice ? await withPreview(baseNotice, userData.tenant_id) : null;
  if (extraNotice && formData.get('confirm_extra_worker') !== 'true') {
    return {
      success: false,
      error: noticeSentence(extraNotice),
      needsExtraWorkerConfirm: extraNotice,
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Server configuration error',
    };
  }

  const tenantId = userData.tenant_id;

  const { data: inviteData, error: inviteError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: emailNorm,
    options: {
      data: {
        full_name: parsed.data.full_name,
        primary_tenant_id: tenantId,
      },
    },
  });

  if (inviteError) {
    console.error('[inviteWorker] generateLink:', inviteError);
    return {
      success: false,
      error: isEmailExistsError(inviteError) ? EMAIL_EXISTS_MESSAGE : inviteError.message,
    };
  }

  const newUserId = inviteData?.user?.id;

  const { data: inserted, error: insertError } = await supabase
    .from('workers')
    .insert({
      primary_tenant_id: tenantId,
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      email: emailNorm,
      home_postcode: parsed.data.home_postcode,
      home_lat: coords.lat,
      home_lng: coords.lng,
      worker_type: parsed.data.worker_type,
      status: parsed.data.status,
      skills: parsed.data.skills,
      invite_status: 'pending',
      user_id: inviteData.user?.id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    console.error('[inviteWorker] insert:', insertError);
    if (newUserId) {
      const { error: delErr } = await admin.auth.admin.deleteUser(newUserId);
      if (delErr) console.error('[inviteWorker] rollback deleteUser:', delErr);
    }
    return {
      success: false,
      error: insertError?.message ?? 'Failed to create worker record',
    };
  }

  const { error: junctionError } = await supabase.from('worker_tenants').insert({
    worker_id: inserted.id,
    tenant_id: tenantId,
    status: 'active',
    is_primary: true,
    added_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (junctionError) {
    console.error('[inviteWorker] worker_tenants insert:', junctionError);
  }

  if (extraNotice && opts.recordConsent !== false) {
    await recordExtraWorkerConsent({
      tenantId,
      userId: user.id,
      workerId: inserted.id,
      notice: extraNotice,
    });
  }

  // Keep the subscription's extra-worker line equal to the count (Stripe-billed Pro businesses only).
  if (opts.reconcile !== 'skip') reconcileExtraWorkersAfterChange(tenantId);

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Only a Subcontractor's invite carries a kind; plain invites leave the column to its default,
  // so inviting an employee never depends on the new column existing.
  const inviteKind = inviteKindFor(parsed.data.worker_type);
  const { error: inviteTokenError } = await admin.from('worker_invites').insert({
    token,
    worker_id: inserted.id,
    tenant_id: tenantId,
    email: emailNorm,
    expires_at: expiresAt,
    ...(inviteKind === 'business' ? { kind: 'business' } : {}),
  });

  if (inviteTokenError) {
    console.error('[inviteWorker] worker_invites insert:', inviteTokenError);
  }

  // Bulk add creates the invite but sends all the emails together at the end.
  if (opts.sendEmail === false) {
    return { success: true, workerId: inserted.id, inviteToken: inviteTokenError ? null : token };
  }

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single();

  const inviteUrl = `https://app.joinworkwise.com/accept-invite?token=${token}`;
  const buildEmail = inviteKind === 'business' ? buildWorkerBusinessInviteEmail : buildWorkerInviteEmail;
  const { subject, html } = buildEmail({
    workerName: parsed.data.full_name,
    inviteUrl,
    tenantName: tenantData?.name ?? 'WorkWise',
  });

  const { error: resendError } = await resend.emails.send({
    from: FROM_EMAIL,
    to: emailNorm,
    subject,
    html,
  });
  if (resendError) {
    console.error('[inviteWorker] resend error:', resendError);
    return { success: false, error: 'Failed to send invitation email. Please try again.' };
  }

  return { success: true, workerId: inserted.id, inviteToken: inviteTokenError ? null : token };
}

