'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { workerSchema } from '@/lib/validations/worker';
import { inviteWorkerPayloadSchema } from '@/lib/validations/worker-invite';
import { buildWorkerInviteEmail } from '@/lib/emails/worker-invite';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { revalidatePath } from 'next/cache';
import { postcodeToLatLng } from '@/lib/utils/postcode';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import type { SupabaseClient } from '@supabase/supabase-js';

const ACTIVE_JOB_STATUSES = ['pending', 'pending_send', 'assigned', 'in_progress'] as const;

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

export async function createWorker(formData: FormData) {
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

  revalidatePath('/workers');
  return { success: true };
}

export async function inviteWorker(formData: FormData) {
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
    return { success: false, error: inviteError.message };
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

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: inviteTokenError } = await admin.from('worker_invites').insert({
    token,
    worker_id: inserted.id,
    tenant_id: tenantId,
    email: emailNorm,
    expires_at: expiresAt,
  });

  if (inviteTokenError) {
    console.error('[inviteWorker] worker_invites insert:', inviteTokenError);
  }

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single();

  const inviteUrl = `https://app.joinworkwise.com/accept-invite?token=${token}`;
  const { subject, html } = buildWorkerInviteEmail({
    workerName: parsed.data.full_name,
    inviteUrl,
    tenantName: tenantData?.name ?? 'WorkWise',
  });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: emailNorm,
      subject,
      html,
    });
  } catch (e) {
    console.error('[inviteWorker] resend:', e);
  }

  revalidatePath('/workers');
  return { success: true };
}

export async function updateWorker(workerId: string, formData: FormData) {
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

  const { data: existing } = await supabase
    .from('workers')
    .select('id, primary_tenant_id')
    .eq('id', workerId)
    .single();

  if (!existing || existing.primary_tenant_id !== userData.tenant_id) {
    return { success: false, error: 'Worker not found or access denied' };
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

  let home_lat: number | null = null;
  let home_lng: number | null = null;
  const coords = await postcodeToLatLng(validated.home_postcode);
  if (coords) {
    home_lat = coords.lat;
    home_lng = coords.lng;
  }

  const updatePayload: Record<string, unknown> = {
    full_name: validated.full_name,
    phone: validated.phone,
    email: validated.email || null,
    home_postcode: validated.home_postcode,
    worker_type: validated.worker_type,
    status: validated.status,
    skills: validated.skills,
    updated_at: new Date().toISOString(),
  };
  if (home_lat != null && home_lng != null) {
    updatePayload.home_lat = home_lat;
    updatePayload.home_lng = home_lng;
  }

  const { error } = await supabase
    .from('workers')
    .update(updatePayload)
    .eq('id', workerId)
    .eq('primary_tenant_id', userData.tenant_id);

  if (error) {
    console.error('Update worker error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/workers');
  revalidatePath(`/workers/${workerId}`);
  return { success: true };
}

export async function updateWorkerAutoAssign(workerId: string, exclude: boolean) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return { success: false, error: 'No tenant found' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('worker_tenants')
    .update({
      exclude_from_auto_assign: exclude,
      updated_at: new Date().toISOString(),
    })
    .eq('worker_id', workerId)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[updateWorkerAutoAssign] error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/workers');
  revalidatePath(`/workers/${workerId}`);
  return { success: true, error: null };
}

async function findAuthUserIdByEmail(
  admin: SupabaseClient,
  email: string
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('[findAuthUserIdByEmail] listUsers:', error);
      return null;
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (match) return match.id;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function deleteAuthUserForWorker(
  admin: SupabaseClient,
  opts: { userId: string | null; email: string | null }
) {
  const userId =
    opts.userId ??
    (opts.email ? await findAuthUserIdByEmail(admin, opts.email) : null);
  if (!userId) return;
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.error('[deleteAuthUserForWorker]', error);
}

async function hardDeleteWorkerRecords(
  supabase: Awaited<ReturnType<typeof createClient>>,
  admin: SupabaseClient,
  workerId: string,
  tenantId: string,
  worker: { user_id: string | null; email: string | null }
) {
  await admin.from('worker_invites').delete().eq('worker_id', workerId);
  await supabase.from('worker_tenants').delete().eq('worker_id', workerId);

  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('id', workerId)
    .eq('primary_tenant_id', tenantId);

  if (error) {
    return { success: false as const, error: error.message };
  }

  await deleteAuthUserForWorker(admin, {
    userId: worker.user_id,
    email: worker.email,
  });

  return { success: true as const };
}

export async function revokeWorkerInvite(inviteId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Server configuration error',
    };
  }

  const { data: invite, error: inviteError } = await supabase
    .from('worker_invites')
    .select('id, worker_id, tenant_id, email, used_at')
    .eq('id', inviteId)
    .single();

  if (inviteError || !invite || invite.tenant_id !== tenantId) {
    return { success: false, error: 'Invite not found or access denied' };
  }

  if (invite.used_at) {
    return {
      success: false,
      error:
        'This worker has already accepted their invite. Use Deactivate instead.',
    };
  }

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select('id, user_id, email, primary_tenant_id, invite_status')
    .eq('id', invite.worker_id)
    .single();

  if (workerError || !worker || worker.primary_tenant_id !== tenantId) {
    return { success: false, error: 'Worker not found or access denied' };
  }

  if (worker.invite_status === 'deactivated' || worker.invite_status === 'accepted') {
    return {
      success: false,
      error:
        'This worker has already accepted their invite. Use Deactivate instead.',
    };
  }

  const result = await hardDeleteWorkerRecords(supabase, admin, worker.id, tenantId, {
    user_id: worker.user_id,
    email: worker.email,
  });

  if (!result.success) {
    return result;
  }

  revalidatePath('/workers');
  return { success: true };
}

export async function resendWorkerInvite(inviteId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Server configuration error',
    };
  }

  const { data: invite, error: inviteError } = await supabase
    .from('worker_invites')
    .select('id, worker_id, tenant_id, email')
    .eq('id', inviteId)
    .single();

  if (inviteError || !invite || invite.tenant_id !== tenantId) {
    return { success: false, error: 'Invite not found or access denied' };
  }

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select('id, full_name, email, primary_tenant_id')
    .eq('id', invite.worker_id)
    .single();

  if (workerError || !worker || worker.primary_tenant_id !== tenantId) {
    return { success: false, error: 'Worker not found or access denied' };
  }

  const emailNorm = (worker.email ?? invite.email ?? '').trim().toLowerCase();
  if (!emailNorm) {
    return { success: false, error: 'Worker has no email address' };
  }

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single();

  const { error: generateError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: emailNorm,
    options: {
      data: {
        full_name: worker.full_name,
        primary_tenant_id: tenantId,
      },
    },
  });

  if (generateError) {
    console.error('[resendWorkerInvite] generateLink:', generateError);
  }

  const { error: deleteInviteError } = await admin
    .from('worker_invites')
    .delete()
    .eq('id', inviteId);

  if (deleteInviteError) {
    console.error('[resendWorkerInvite] delete old invite:', deleteInviteError);
    return { success: false, error: deleteInviteError.message };
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await admin.from('worker_invites').insert({
    token,
    worker_id: worker.id,
    tenant_id: tenantId,
    email: emailNorm,
    expires_at: expiresAt,
  });

  if (insertError) {
    console.error('[resendWorkerInvite] insert invite:', insertError);
    return { success: false, error: insertError.message };
  }

  const inviteUrl = `https://app.joinworkwise.com/accept-invite?token=${token}`;
  const { subject, html } = buildWorkerInviteEmail({
    workerName: worker.full_name,
    inviteUrl,
    tenantName: tenantData?.name ?? 'WorkWise',
  });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: emailNorm,
      subject,
      html,
    });
  } catch (e) {
    console.error('[resendWorkerInvite] resend:', e);
  }

  revalidatePath('/workers');
  return { success: true };
}

export async function deactivateWorker(workerId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select('id, user_id, primary_tenant_id')
    .eq('id', workerId)
    .single();

  if (workerError || !worker || worker.primary_tenant_id !== tenantId) {
    return { success: false, error: 'Worker not found or access denied' };
  }

  const { data: activeJobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('assigned_worker_id', workerId)
    .in('status', [...ACTIVE_JOB_STATUSES])
    .limit(1);

  if (activeJobs && activeJobs.length > 0) {
    return {
      success: false,
      error: 'Worker has active jobs. Reassign or complete them first.',
    };
  }

  if (worker.user_id) {
    let admin: ReturnType<typeof createAdminClient>;
    try {
      admin = createAdminClient();
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Server configuration error',
      };
    }
    const { error: banError } = await admin.auth.admin.updateUserById(worker.user_id, {
      ban_duration: '876000h',
    });
    if (banError) {
      console.error('[deactivateWorker] ban:', banError);
      return { success: false, error: banError.message };
    }
  }

  const { error } = await supabase
    .from('workers')
    .update({
      status: 'off_duty',
      invite_status: 'deactivated',
      updated_at: new Date().toISOString(),
    })
    .eq('id', workerId)
    .eq('primary_tenant_id', tenantId);

  if (error) {
    console.error('[deactivateWorker]', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/workers');
  revalidatePath(`/workers/${workerId}`);
  return { success: true };
}

export async function reactivateWorker(workerId: string) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const supabase = await createClient();

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select('id, user_id, primary_tenant_id')
    .eq('id', workerId)
    .single();

  if (workerError || !worker || worker.primary_tenant_id !== tenantId) {
    return { success: false, error: 'Worker not found or access denied' };
  }

  if (worker.user_id) {
    let admin: ReturnType<typeof createAdminClient>;
    try {
      admin = createAdminClient();
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Server configuration error',
      };
    }
    const { error: unbanError } = await admin.auth.admin.updateUserById(worker.user_id, {
      ban_duration: '0',
    });
    if (unbanError) {
      console.error('[reactivateWorker] unban:', unbanError);
      return { success: false, error: unbanError.message };
    }
  }

  const { error } = await supabase
    .from('workers')
    .update({
      status: 'available',
      invite_status: 'accepted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', workerId)
    .eq('primary_tenant_id', tenantId);

  if (error) {
    console.error('[reactivateWorker]', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/workers');
  revalidatePath(`/workers/${workerId}`);
  return { success: true };
}

export async function deleteWorker(workerId: string) {
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

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select('id, user_id, email, primary_tenant_id')
    .eq('id', workerId)
    .single();

  if (workerError || !worker || worker.primary_tenant_id !== userData.tenant_id) {
    return { success: false, error: 'Worker not found or access denied' };
  }

  if (worker.user_id) {
    return {
      success: false,
      error:
        'This worker has accepted their invite. Use Deactivate instead of Delete to preserve job history.',
    };
  }

  const { data: activeJobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('assigned_worker_id', workerId)
    .in('status', [...ACTIVE_JOB_STATUSES])
    .limit(1);

  if (activeJobs && activeJobs.length > 0) {
    return {
      success: false,
      error:
        'Cannot delete worker with active jobs. Reassign jobs first.',
    };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Server configuration error',
    };
  }

  const result = await hardDeleteWorkerRecords(
    supabase,
    admin,
    workerId,
    userData.tenant_id,
    { user_id: worker.user_id, email: worker.email }
  );

  if (!result.success) {
    return result;
  }

  revalidatePath('/workers');
  return { success: true };
}

/** Get count of active jobs for a worker (for delete confirmation) */
export async function getWorkerActiveJobCount(workerId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('assigned_worker_id', workerId)
    .in('status', [...ACTIVE_JOB_STATUSES]);
  return count ?? 0;
}

/** Bulk delete workers (only those without active jobs) */
export async function bulkDeleteWorkers(workerIds: string[]) {
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

  if (!userData?.tenant_id || !workerIds.length) {
    return { success: false, error: 'No tenant or no workers selected' };
  }

  const { data: workersToDelete, error: loadError } = await supabase
    .from('workers')
    .select('id, user_id')
    .eq('primary_tenant_id', userData.tenant_id)
    .in('id', workerIds);

  if (loadError) {
    return { success: false, error: loadError.message };
  }

  if (workersToDelete?.some((w) => w.user_id)) {
    return {
      success: false,
      error:
        'One or more selected workers have accepted their invite. Use Deactivate instead of Delete.',
    };
  }

  for (const workerId of workerIds) {
    const { data: active } = await supabase
      .from('jobs')
      .select('id')
      .eq('assigned_worker_id', workerId)
      .in('status', [...ACTIVE_JOB_STATUSES])
      .limit(1)
      .maybeSingle();
    if (active) {
      return {
        success: false,
        error: 'One or more selected workers have active jobs. Reassign or complete jobs first.',
      };
    }
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Server configuration error',
    };
  }

  for (const workerId of workerIds) {
    const { data: worker } = await supabase
      .from('workers')
      .select('user_id, email')
      .eq('id', workerId)
      .single();
    const result = await hardDeleteWorkerRecords(
      supabase,
      admin,
      workerId,
      userData.tenant_id,
      { user_id: worker?.user_id ?? null, email: worker?.email ?? null }
    );
    if (!result.success) {
      return result;
    }
  }

  revalidatePath('/workers');
  return { success: true };
}

/** Bulk update status for selected worker IDs */
export async function bulkUpdateWorkerStatus(
  workerIds: string[],
  status: string
) {
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

  if (!userData?.tenant_id || !workerIds.length) {
    return { success: false, error: 'No tenant or no workers selected' };
  }

  const validStatuses = ['available', 'busy', 'unavailable', 'off_duty'];
  if (!validStatuses.includes(status)) {
    return { success: false, error: 'Invalid status' };
  }

  const { error } = await supabase
    .from('workers')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('primary_tenant_id', userData.tenant_id)
    .in('id', workerIds);

  if (error) {
    console.error('Bulk update worker status error:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/workers');
  return { success: true };
}
