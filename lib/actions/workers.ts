'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { workerSchema } from '@/lib/validations/worker';
import { workerInviteSchema } from '@/lib/validations/worker-invite';
import { revalidatePath } from 'next/cache';
import { postcodeToLatLng } from '@/lib/utils/postcode';

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

  const { error } = await supabase.from('workers').insert({
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
  });

  if (error) {
    console.error('Create worker error:', error);
    return { success: false, error: error.message };
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

  const raw = {
    full_name: formData.get('full_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
  };

  const parsed = workerInviteSchema.safeParse({
    full_name: typeof raw.full_name === 'string' ? raw.full_name : '',
    email: typeof raw.email === 'string' ? raw.email : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
  });

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    const message =
      fe.full_name?.[0] ||
      fe.email?.[0] ||
      fe.phone?.[0] ||
      parsed.error.message;
    return { success: false, error: message ?? 'Validation failed' };
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

  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    emailNorm,
    {
      data: {
        full_name: parsed.data.full_name,
        primary_tenant_id: tenantId,
      },
    }
  );

  if (inviteError) {
    console.error('[inviteWorker] inviteUserByEmail:', inviteError);
    return { success: false, error: inviteError.message };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('workers')
    .insert({
      primary_tenant_id: tenantId,
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      email: emailNorm,
      invite_status: 'pending',
      user_id: null,
      status: 'unavailable',
      worker_type: 'company_subcontractor',
      skills: [],
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    console.error('[inviteWorker] insert:', insertError);
    const newUserId = inviteData.user?.id;
    if (newUserId) {
      const { error: delErr } = await admin.auth.admin.deleteUser(newUserId);
      if (delErr) console.error('[inviteWorker] rollback deleteUser:', delErr);
    }
    return {
      success: false,
      error: insertError?.message ?? 'Failed to create worker record',
    };
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

  const { data: activeJobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('assigned_worker_id', workerId)
    .in('status', ['pending', 'pending_send', 'assigned', 'in_progress'])
    .limit(1);

  if (activeJobs && activeJobs.length > 0) {
    return {
      success: false,
      error:
        'Cannot delete worker with active jobs. Reassign jobs first.',
    };
  }

  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('id', workerId)
    .eq('primary_tenant_id', userData.tenant_id);

  if (error) {
    console.error('Delete worker error:', error);
    return { success: false, error: error.message };
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
    .in('status', ['pending', 'pending_send', 'assigned', 'in_progress']);
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

  for (const workerId of workerIds) {
    const { data: active } = await supabase
      .from('jobs')
      .select('id')
      .eq('assigned_worker_id', workerId)
      .in('status', ['pending', 'pending_send', 'assigned', 'in_progress'])
      .limit(1)
      .maybeSingle();
    if (active) {
      return {
        success: false,
        error: 'One or more selected workers have active jobs. Reassign or complete jobs first.',
      };
    }
  }

  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('primary_tenant_id', userData.tenant_id)
    .in('id', workerIds);

  if (error) {
    console.error('Bulk delete workers error:', error);
    return { success: false, error: error.message };
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
