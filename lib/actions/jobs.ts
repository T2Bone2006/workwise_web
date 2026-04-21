'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { createJobSchema } from '@/lib/validations/job';
import { postcodeToLatLng } from '@/lib/utils/postcode';
import { haversineDistance } from '@/lib/utils/haversine';
import { buildFullAddressString, geocodeAddress } from '@/lib/utils/geocoding';
import { detectSkills } from '@/lib/detect-skills';
import { logUserEdit } from '@/lib/services/ai-logger';
import { sendJobAssignedPushToWorker } from '@/lib/services/worker-push';
import {
  parseWorkerSkillsArray,
  requiredSkillBreakdown,
  skillMatchLevelForJob,
  type RankedWorkerForJob,
} from '@/lib/jobs/worker-skill-match';

export type CreateJobResult =
  | { success: true; jobId: string }
  | { success: false; error: string };

/** When form uses "Detect skills" and user edits, pass this so we log the correction for training. */
export type OverrideSkillsPayload = {
  skills: string[];
  interactionId: string;
  originalSkills: string[];
};

type CreateJobPayload = {
  reference_number?: string;
  customer_id: string;
  address: string;
  postcode: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  scheduled_date?: string;
  assigned_worker_id?: string;
  /** If provided, use these skills and log user edits for AI training. */
  overrideSkills?: OverrideSkillsPayload;
};

export async function createJob(payload: CreateJobPayload): Promise<CreateJobResult> {
  try {
    const raw = {
      reference_number: payload.reference_number?.trim() || undefined,
      customer_id: payload.customer_id?.trim(),
      address: payload.address?.trim(),
      postcode: payload.postcode?.trim(),
      description: payload.description?.trim(),
      priority: payload.priority,
      scheduled_date: payload.scheduled_date?.trim() || undefined,
      assigned_worker_id: payload.assigned_worker_id?.trim() || undefined,
    };

    const parsed = createJobSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.flatten().fieldErrors;
      const message =
        (first.customer_id?.[0]) ||
        (first.address?.[0]) ||
        (first.postcode?.[0]) ||
        (first.description?.[0]) ||
        (first.priority?.[0]) ||
        (first.assigned_worker_id?.[0]) ||
        parsed.error.message;
      return { success: false, error: message ?? 'Validation failed' };
    }

    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned. Please contact your administrator.' };
    }

    const supabase = await createClient();
    let referenceNumber = parsed.data.reference_number?.trim();

    if (!referenceNumber) {
      const { data: existing } = await supabase
        .from('jobs')
        .select('reference_number')
        .eq('tenant_id', tenantId)
        .like('reference_number', 'JOB-%')
        .order('reference_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastNum = existing?.reference_number
        ? parseInt(existing.reference_number.replace(/^JOB-/, ''), 10)
        : 0;
      const nextNum = isNaN(lastNum) ? 1 : lastNum + 1;
      referenceNumber = `JOB-${String(nextNum).padStart(3, '0')}`;
    }

    const assignedWorkerId =
      parsed.data.assigned_worker_id && parsed.data.assigned_worker_id.length > 0
        ? parsed.data.assigned_worker_id
        : null;

    let requiredSkills: string[];
    if (
      payload.overrideSkills &&
      Array.isArray(payload.overrideSkills.skills) &&
      payload.overrideSkills.interactionId
    ) {
      requiredSkills = payload.overrideSkills.skills;
      const { interactionId, originalSkills } = payload.overrideSkills;
      const edited =
        originalSkills.length !== requiredSkills.length ||
        originalSkills.some((s, i) => s !== requiredSkills[i]);
      if (edited && interactionId) {
        logUserEdit(interactionId, originalSkills, requiredSkills).catch((err) =>
          console.error('[createJob] logUserEdit failed:', err)
        );
      }
    } else {
      const result = await detectSkills(
        {
          description: parsed.data.description,
          address: parsed.data.address,
          priority: parsed.data.priority,
        }
      );
      requiredSkills = result.data;
    }

    const fullAddress = buildFullAddressString([parsed.data.address, parsed.data.postcode]);
    const geocoded = await geocodeAddress(fullAddress);

    const { data: job, error: insertError } = await supabase
      .from('jobs')
      .insert({
        tenant_id: tenantId,
        reference_number: referenceNumber,
        customer_id: parsed.data.customer_id,
        assigned_worker_id: assignedWorkerId,
        address: parsed.data.address,
        postcode: parsed.data.postcode,
        job_description: parsed.data.description,
        status: 'pending',
        priority: parsed.data.priority,
        scheduled_date: parsed.data.scheduled_date || null,
        required_skills: requiredSkills,
        lat: geocoded?.lat ?? null,
        lng: geocoded?.lng ?? null,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[createJob] insert error:', insertError);
      if (insertError.code === '23503') {
        return { success: false, error: 'Customer or worker not found. Please refresh and try again.' };
      }
      return { success: false, error: insertError.message ?? 'Failed to create job.' };
    }

    if (!job?.id) {
      return { success: false, error: 'Failed to create job.' };
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { error: historyError } = await supabase
      .from('job_status_history')
      .insert({
        job_id: job.id,
        from_status: null,
        to_status: 'pending',
        created_at: new Date().toISOString(),
        changed_by_user_id: user?.id ?? null,
        changed_by_worker_id: null,
      });

    if (historyError) {
      console.error('[createJob] job_status_history insert error:', historyError);
      // Job was created; don't fail the request
    } else {
      console.log('[createJob] job_status_history insert ok for job', job.id);
    }

    revalidatePath('/jobs');
    return { success: true, jobId: job.id };
  } catch (err) {
    console.error('[createJob]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to create job. Please try again.',
    };
  }
}

export type UpdateJobStatusResult =
  | { success: true }
  | { success: false; error: string };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ['assigned', 'cancelled', 'pending_send'],
  pending_send: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['assigned'],
  cancelled: [],
};

export async function updateJobStatus(
  jobId: string,
  newStatus: string
): Promise<UpdateJobStatusResult> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('id, status')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchError || !job) {
      return { success: false, error: 'Job not found or access denied.' };
    }

    const currentStatus = (job.status as string) ?? 'pending';
    const allowed = ALLOWED_TRANSITIONS[currentStatus];
    if (!allowed?.includes(newStatus)) {
      return { success: false, error: `Cannot change status from ${currentStatus} to ${newStatus}.` };
    }

    const updates: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === 'completed') {
      updates.completed_at = new Date().toISOString();
    }
    if (newStatus === 'in_progress') {
      updates.started_at = new Date().toISOString();
    }
    if (currentStatus === 'completed' && newStatus === 'assigned') {
      updates.completed_at = null;
    }

    const { error: updateError } = await supabase
      .from('jobs')
      .update(updates)
      .eq('id', jobId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('[updateJobStatus] update error:', updateError);
      return { success: false, error: updateError.message ?? 'Failed to update status.' };
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { error: historyError } = await supabase
      .from('job_status_history')
      .insert({
        job_id: jobId,
        from_status: currentStatus,
        to_status: newStatus,
        created_at: new Date().toISOString(),
        changed_by_user_id: user?.id ?? null,
        changed_by_worker_id: null,
        notes: null,
        metadata: {},
      });

    if (historyError) {
      console.error('[updateJobStatus] job_status_history insert error:', historyError);
      console.error('[updateJobStatus] code:', historyError.code, 'details:', historyError.details);
      // Still return success - job status was updated
    } else {
      console.log('[updateJobStatus] job_status_history insert ok');
    }

    revalidatePath('/jobs');
    revalidatePath(`/jobs/${jobId}`);
    return { success: true };
  } catch (err) {
    console.error('[updateJobStatus]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to update status. Please try again.',
    };
  }
}

export type AssignJobResult =
  | { success: true }
  | { success: false; error: string };

export type AssignJobOptions = {
  /** Auto-allocation: worker chosen but job not sent to mobile yet (no push until "Send out"). */
  pendingSend?: boolean;
};

export async function assignJob(
  jobId: string,
  workerId: string,
  options?: AssignJobOptions
): Promise<AssignJobResult> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('id, status')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchError || !job) {
      return { success: false, error: 'Job not found or access denied.' };
    }

    const current = (job.status as string) ?? 'pending';
    let newStatus: string;
    if (current === 'pending') {
      newStatus = options?.pendingSend ? 'pending_send' : 'assigned';
    } else if (current === 'pending_send') {
      newStatus = 'pending_send';
    } else {
      newStatus = current;
    }
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        assigned_worker_id: workerId,
        status: newStatus,
        updated_at: new Date().toISOString(),
        auto_assign_failure_reason: null,
      })
      .eq('id', jobId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('[assignJob] update error:', updateError);
      if (updateError.code === '23503') {
        return { success: false, error: 'Worker not found.' };
      }
      return { success: false, error: updateError.message ?? 'Failed to assign worker.' };
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { error: historyError } = await supabase
      .from('job_status_history')
      .insert({
        job_id: jobId,
        from_status: job.status,
        to_status: newStatus,
        created_at: new Date().toISOString(),
        changed_by_user_id: user?.id ?? null,
        changed_by_worker_id: null,
        notes: 'Worker assigned',
        metadata: {},
      });

    if (historyError) {
      console.error('[assignJob] job_status_history insert error:', historyError);
      console.error('[assignJob] code:', historyError.code, 'details:', historyError.details);
    } else {
      console.log('[assignJob] job_status_history insert ok');
    }

    revalidatePath('/jobs');
    revalidatePath(`/jobs/${jobId}`);
    return { success: true };
  } catch (err) {
    console.error('[assignJob]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to assign worker. Please try again.',
    };
  }
}

export type AutoAllocateJobResult =
  | { success: true; workerId: string; workerName: string; distance: number }
  | { success: false; error: string };

/** Re-export for callers that import job actions and types together. */
export type {
  RankedWorkerForJob,
  WorkerSkillMatchLevel,
} from '@/lib/jobs/worker-skill-match';

/**
 * Ranks all available tenant workers for a job: distance (then active job count), same as {@link autoAllocateJob},
 * but includes every available worker (not only full skill matches) with skill match metadata for manual selection.
 */
export type RankedWorkersForJobResult =
  | {
      success: true;
      /** Workers with at least one required skill match (or all workers if job has no required skills). */
      workers: RankedWorkerForJob[];
      /** When the job lists required skills: workers with none of those skills (still shown for manual pick). */
      workersNoRequiredSkillMatch: RankedWorkerForJob[];
    }
  | { success: false; error: string };

export async function getRankedWorkersForJob(jobId: string): Promise<RankedWorkersForJobResult> {
  try {
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
      return { success: false, error: 'No tenant' };
    }

    const { data: job, error: jobFetchError } = await supabase
      .from('jobs')
      .select('id, postcode, required_skills, tenant_id')
      .eq('id', jobId)
      .eq('tenant_id', userData.tenant_id)
      .single();

    if (jobFetchError || !job) {
      return { success: false, error: 'Job not found' };
    }

    const jobCoords = await postcodeToLatLng(job.postcode);
    const requiredSkills = (job.required_skills as string[] | null) ?? [];

    const { data: workersRaw, error: workersError } = await supabase
      .from('workers')
      .select('id, full_name, home_lat, home_lng, skills')
      .eq('primary_tenant_id', userData.tenant_id)
      .eq('status', 'available');

    if (workersError) {
      console.error('[getRankedWorkersForJob] workers fetch error:', workersError);
      return { success: false, error: 'Failed to load workers' };
    }

    const workersList = workersRaw ?? [];
    if (workersList.length === 0) {
      return { success: true, workers: [], workersNoRequiredSkillMatch: [] };
    }

    const workerIds = workersList.map((w) => w.id);
    const { data: jobCounts } = await supabase
      .from('jobs')
      .select('assigned_worker_id')
      .in('assigned_worker_id', workerIds)
      .in('status', ['assigned', 'in_progress', 'pending_send']);

    const jobCountMap = new Map<string, number>();
    jobCounts?.forEach((row) => {
      const id = row.assigned_worker_id as string;
      if (id) {
        jobCountMap.set(id, (jobCountMap.get(id) ?? 0) + 1);
      }
    });

    const sortByDistanceThenLoad = (a: RankedWorkerForJob, b: RankedWorkerForJob) => {
      const da = a.distanceKm ?? Infinity;
      const db = b.distanceKm ?? Infinity;
      if (da !== db) return da - db;
      return a.currentJobs - b.currentJobs;
    };

    const ranked: RankedWorkerForJob[] = workersList.map((w) => {
      const ws = parseWorkerSkillsArray(w.skills);
      const { matched: matchedRequiredSkills, missing: missingRequiredSkills } =
        requiredSkillBreakdown(requiredSkills, ws);
      const skillMatch = skillMatchLevelForJob(requiredSkills, ws);
      let distanceKm: number | null = null;
      if (
        jobCoords &&
        w.home_lat != null &&
        w.home_lng != null &&
        !Number.isNaN(Number(w.home_lat)) &&
        !Number.isNaN(Number(w.home_lng))
      ) {
        distanceKm = haversineDistance(
          jobCoords.lat,
          jobCoords.lng,
          Number(w.home_lat),
          Number(w.home_lng)
        );
      }
      return {
        id: w.id,
        full_name: (w.full_name as string) ?? '',
        distanceKm,
        currentJobs: jobCountMap.get(w.id) ?? 0,
        skillMatch,
        matchedRequiredSkills,
        missingRequiredSkills,
      };
    });

    if (requiredSkills.length === 0) {
      ranked.sort(sortByDistanceThenLoad);
      return { success: true, workers: ranked, workersNoRequiredSkillMatch: [] };
    }

    const withSkillMatch = ranked.filter((w) => w.matchedRequiredSkills.length > 0);
    const noSkillMatch = ranked.filter((w) => w.matchedRequiredSkills.length === 0);
    withSkillMatch.sort(sortByDistanceThenLoad);
    noSkillMatch.sort(sortByDistanceThenLoad);

    return {
      success: true,
      workers: withSkillMatch,
      workersNoRequiredSkillMatch: noSkillMatch,
    };
  } catch (err) {
    console.error('[getRankedWorkersForJob]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to rank workers.',
    };
  }
}

async function persistAutoAssignFailureReason(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  tenantId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update({
      auto_assign_failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('tenant_id', tenantId);
  if (error) {
    console.error('[persistAutoAssignFailureReason]', error);
  }
}

export async function autoAllocateJob(jobId: string): Promise<AutoAllocateJobResult> {
  const supabase = await createClient();
  let tenantId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    tenantId = userData?.tenant_id ?? null;
    if (!tenantId) {
      return { success: false, error: 'No tenant' };
    }

    const fail = async (message: string): Promise<AutoAllocateJobResult> => {
      await persistAutoAssignFailureReason(supabase, jobId, tenantId!, message);
      return { success: false, error: message };
    };

    const { data: job, error: jobFetchError } = await supabase
      .from('jobs')
      .select('id, postcode, required_skills, tenant_id')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .single();

    if (jobFetchError || !job) {
      return { success: false, error: 'Job not found' };
    }

    const jobCoords = await postcodeToLatLng(job.postcode);
    if (!jobCoords) {
      return await fail('Invalid job postcode');
    }
    console.log('[autoAllocateJob] job coordinates', { jobId, postcode: job.postcode, ...jobCoords });

    const requiredSkills = (job.required_skills as string[] | null) ?? [];
    const requiredSet = new Set(requiredSkills);

    const { data: workersRaw, error: workersError } = await supabase
      .from('workers')
      .select('id, full_name, home_lat, home_lng, home_postcode, skills')
      .eq('primary_tenant_id', tenantId)
      .eq('status', 'available')
      .not('home_lat', 'is', null)
      .not('home_lng', 'is', null);

    if (workersError) {
      console.error('[autoAllocateJob] workers fetch error:', workersError);
      return await fail('Failed to load workers');
    }

    // Filter workers who have all required skills (in-memory to avoid JSONB @> serialization issues)
    const workers =
      requiredSet.size === 0
        ? workersRaw ?? []
        : (workersRaw ?? []).filter((w) => {
            const arr = parseWorkerSkillsArray(w.skills);
            const workerSet = new Set(arr);
            return [...requiredSet].every((skill) => workerSet.has(skill));
          });

    if (!workers || workers.length === 0) {
      const message =
        requiredSkills.length > 0
          ? `No workers with required skills: ${requiredSkills.join(', ')}`
          : 'No available workers';
      return await fail(message);
    }
    console.log('[autoAllocateJob] worker count found:', workers.length);

    const workersWithDistance = workers.map((worker) => ({
      ...worker,
      distance: haversineDistance(
        jobCoords.lat,
        jobCoords.lng,
        Number(worker.home_lat),
        Number(worker.home_lng)
      ),
    }));
    console.log(
      '[autoAllocateJob] distances (km):',
      workersWithDistance.map((w) => ({
        id: w.id,
        name: w.full_name,
        distance: Math.round(w.distance * 10) / 10,
      }))
    );

    const workerIds = workers.map((w) => w.id);
    const { data: jobCounts } = await supabase
      .from('jobs')
      .select('assigned_worker_id')
      .in('assigned_worker_id', workerIds)
      .in('status', ['assigned', 'in_progress', 'pending_send']);

    const jobCountMap = new Map<string, number>();
    jobCounts?.forEach((row) => {
      const id = row.assigned_worker_id as string;
      if (id) {
        jobCountMap.set(id, (jobCountMap.get(id) ?? 0) + 1);
      }
    });

    const rankedWorkers = workersWithDistance
      .map((worker) => ({
        ...worker,
        currentJobs: jobCountMap.get(worker.id) ?? 0,
      }))
      .sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.currentJobs - b.currentJobs;
      });

    const bestWorker = rankedWorkers[0];
    console.log('[autoAllocateJob] selected worker', {
      id: bestWorker.id,
      name: bestWorker.full_name,
      distance: Math.round(bestWorker.distance * 10) / 10,
      currentJobs: bestWorker.currentJobs,
    });

    const assignResult = await assignJob(jobId, bestWorker.id, { pendingSend: true });
    if (!assignResult.success) {
      return await fail(assignResult.error ?? 'Failed to assign worker');
    }

    return {
      success: true,
      workerId: bestWorker.id,
      workerName: bestWorker.full_name,
      distance: Math.round(bestWorker.distance * 10) / 10,
    };
  } catch (err) {
    console.error('[autoAllocateJob]', err);
    const message =
      err instanceof Error ? err.message : 'Unable to auto-allocate. Please try again.';
    if (tenantId) {
      await persistAutoAssignFailureReason(supabase, jobId, tenantId, message);
    }
    return { success: false, error: message };
  }
}

export async function autoAssignJob(jobId: string): Promise<AssignJobResult> {
  const result = await autoAllocateJob(jobId);
  if (result.success) {
    return { success: true };
  }
  return { success: false, error: result.error };
}

export type SendPendingJobsResult =
  | { success: true; sent: number }
  | { success: false; error: string };

/**
 * Confirms all jobs in `pending_send`: sets status to `assigned` and sends Expo push per worker token.
 */
export async function sendPendingJobsToWorkers(): Promise<SendPendingJobsResult> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: jobs, error: listError } = await supabase
      .from('jobs')
      .select('id, reference_number, assigned_worker_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_send')
      .not('assigned_worker_id', 'is', null);

    if (listError) {
      console.error('[sendPendingJobsToWorkers] list', listError);
      return { success: false, error: listError.message ?? 'Failed to load jobs.' };
    }

    const list = jobs ?? [];
    if (list.length === 0) {
      return { success: false, error: 'No jobs ready to send.' };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    const now = new Date().toISOString();
    let sent = 0;

    for (const job of list) {
      const workerId = job.assigned_worker_id as string;
      const { error: upErr } = await supabase
        .from('jobs')
        .update({ status: 'assigned', updated_at: now })
        .eq('id', job.id)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending_send');

      if (upErr) {
        console.error('[sendPendingJobsToWorkers] update', upErr);
        continue;
      }

      const { error: histErr } = await supabase.from('job_status_history').insert({
        job_id: job.id,
        from_status: 'pending_send',
        to_status: 'assigned',
        created_at: now,
        changed_by_user_id: userId,
        changed_by_worker_id: null,
        notes: 'Sent to worker',
        metadata: {},
      });

      if (histErr) {
        console.error('[sendPendingJobsToWorkers] history', histErr);
      }

      await sendJobAssignedPushToWorker({
        supabase,
        tenantId,
        workerId,
        jobId: job.id,
        referenceNumber: (job.reference_number as string) ?? job.id.slice(0, 8),
      });
      sent += 1;
    }

    revalidatePath('/jobs');
    for (const job of list) {
      revalidatePath(`/jobs/${job.id}`);
    }
    return { success: true, sent };
  } catch (err) {
    console.error('[sendPendingJobsToWorkers]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to send jobs.',
    };
  }
}

export type SendJobToWorkerResult = { success: true } | { success: false; error: string };

export async function sendJobToWorker(jobId: string): Promise<SendJobToWorkerResult> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('id, reference_number, assigned_worker_id, status')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchError || !job) {
      return { success: false, error: 'Job not found or access denied.' };
    }

    if ((job.status as string) !== 'pending_send' || !job.assigned_worker_id) {
      return { success: false, error: 'This job is not waiting to be sent to a worker.' };
    }

    const now = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('jobs')
      .update({ status: 'assigned', updated_at: now })
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_send');

    if (upErr) {
      console.error('[sendJobToWorker] update', upErr);
      return { success: false, error: upErr.message ?? 'Failed to update job.' };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: histErr } = await supabase.from('job_status_history').insert({
      job_id: jobId,
      from_status: 'pending_send',
      to_status: 'assigned',
      created_at: now,
      changed_by_user_id: user?.id ?? null,
      changed_by_worker_id: null,
      notes: 'Sent to worker',
      metadata: {},
    });

    if (histErr) {
      console.error('[sendJobToWorker] history', histErr);
    }

    await sendJobAssignedPushToWorker({
      supabase,
      tenantId,
      workerId: job.assigned_worker_id as string,
      jobId,
      referenceNumber: (job.reference_number as string) ?? jobId.slice(0, 8),
    });

    revalidatePath('/jobs');
    revalidatePath(`/jobs/${jobId}`);
    return { success: true };
  } catch (err) {
    console.error('[sendJobToWorker]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to send job.',
    };
  }
}

export type DeleteJobResult =
  | { success: true }
  | { success: false; error: string };

const DELETE_IN_PROGRESS_ERROR =
  'Cannot delete a job that is in progress. Complete the job or change its status first.';

async function deleteJobRelatedRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobIds: string[]
) {
  if (jobIds.length === 0) return { error: null as Error | null };
  const { error: attErr } = await supabase.from('job_attachments').delete().in('job_id', jobIds);
  if (attErr) {
    console.error('[deleteJobRelatedRows] job_attachments', attErr);
    return { error: attErr };
  }
  const { error: histErr } = await supabase.from('job_status_history').delete().in('job_id', jobIds);
  if (histErr) {
    console.error('[deleteJobRelatedRows] job_status_history', histErr);
    return { error: histErr };
  }
  return { error: null };
}

export async function deleteJob(jobId: string): Promise<DeleteJobResult> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('id, status')
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchError || !job) {
      return { success: false, error: 'Job not found or access denied.' };
    }
    if ((job.status as string) === 'in_progress') {
      return { success: false, error: DELETE_IN_PROGRESS_ERROR };
    }

    const { error: relErr } = await deleteJobRelatedRows(supabase, [jobId]);
    if (relErr) {
      return { success: false, error: relErr.message };
    }

    const { error: delErr } = await supabase
      .from('jobs')
      .delete()
      .eq('id', jobId)
      .eq('tenant_id', tenantId);

    if (delErr) {
      console.error('[deleteJob] jobs', delErr);
      return { success: false, error: delErr.message };
    }

    revalidatePath('/jobs');
    revalidatePath(`/jobs/${jobId}`);
    return { success: true };
  } catch (err) {
    console.error('[deleteJob]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to delete job.',
    };
  }
}

export async function bulkDeleteJobs(jobIds: string[]): Promise<DeleteJobResult> {
  try {
    const uniqueIds = [...new Set(jobIds)];
    if (!uniqueIds.length) {
      return { success: false, error: 'No jobs selected.' };
    }

    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: rows, error: fetchError } = await supabase
      .from('jobs')
      .select('id, status, reference_number')
      .eq('tenant_id', tenantId)
      .in('id', uniqueIds);

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }
    if (!rows?.length) {
      return { success: false, error: 'No matching jobs found or access denied.' };
    }
    if (rows.length !== uniqueIds.length) {
      return { success: false, error: 'Some selected jobs were not found or access denied.' };
    }

    const blocked = rows.filter((r) => (r.status as string) === 'in_progress');
    if (blocked.length > 0) {
      const refs = blocked
        .map((r) => (r.reference_number as string) || (r.id as string).slice(0, 8))
        .slice(0, 5)
        .join(', ');
      const suffix = blocked.length > 5 ? '…' : '';
      return {
        success: false,
        error: `Cannot delete job(s) that are in progress (${refs}${suffix}). Complete or change status first.`,
      };
    }

    const { error: relErr } = await deleteJobRelatedRows(supabase, uniqueIds);
    if (relErr) {
      return { success: false, error: relErr.message };
    }

    const { error: delErr } = await supabase
      .from('jobs')
      .delete()
      .eq('tenant_id', tenantId)
      .in('id', uniqueIds);

    if (delErr) {
      console.error('[bulkDeleteJobs] jobs', delErr);
      return { success: false, error: delErr.message };
    }

    revalidatePath('/jobs');
    for (const id of uniqueIds) {
      revalidatePath(`/jobs/${id}`);
    }
    return { success: true };
  } catch (err) {
    console.error('[bulkDeleteJobs]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to delete jobs.',
    };
  }
}
