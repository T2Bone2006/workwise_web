'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { createJobSchema } from '@/lib/validations/job';
import { postcodeToLatLng } from '@/lib/utils/postcode';
import { haversineDistance } from '@/lib/utils/haversine';
import { buildFullAddressString, geocodeAddress } from '@/lib/utils/geocoding';
import { detectSkills } from '@/lib/detect-skills';
import { getTenantSkills } from '@/lib/actions/skills';
import { logUserEdit } from '@/lib/services/ai-logger';
import { sendJobAssignedPushToWorker } from '@/lib/services/worker-push';
import { getConnectionsForTenant } from '@/lib/data/network';
import { dispatchJobToNetwork, handleNetworkJobDeclined } from '@/lib/actions/network';
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

    const requestedAssignment =
      parsed.data.assigned_worker_id && parsed.data.assigned_worker_id.length > 0
        ? parsed.data.assigned_worker_id
        : null;
    const isBusinessAssignment = requestedAssignment?.startsWith('business:') ?? false;
    const assignedWorkerId = isBusinessAssignment ? null : requestedAssignment;
    const assignedBusinessConnectionId = isBusinessAssignment
      ? requestedAssignment!.slice('business:'.length)
      : null;
    if (isBusinessAssignment && !assignedBusinessConnectionId) {
      return { success: false, error: 'Invalid connected business assignment.' };
    }

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
      const tenantSkillRows = await getTenantSkills(tenantId);
      const tenantSkills = tenantSkillRows.map(({ key, label }) => ({ key, label }));
      const result = await detectSkills({
        description: parsed.data.description,
        address: parsed.data.address,
        priority: parsed.data.priority,
        tenantSkills,
      });
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

    if (assignedBusinessConnectionId) {
      const dispatchResult = await dispatchJobToNetwork(job.id, assignedBusinessConnectionId);
      if (!dispatchResult.success) {
        return {
          success: false,
          error: dispatchResult.error ?? 'Failed to dispatch job to connected business.',
        };
      }
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
  pending: ['assigned', 'cancelled', 'pending_send', 'declined'],
  pending_send: ['assigned', 'cancelled', 'declined'],
  assigned: ['in_progress', 'cancelled', 'declined'],
  in_progress: ['completed', 'cancelled', 'paused'],
  paused: ['in_progress'],
  completed: ['assigned'],
  declined: ['pending', 'assigned'],
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
      .select('id, status, network_dispatch_id')
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

    if (newStatus === 'declined') {
      const dispatchId =
        typeof job.network_dispatch_id === 'string' && job.network_dispatch_id.length > 0
          ? job.network_dispatch_id
          : null;

      if (dispatchId) {
        const declinedResult = await handleNetworkJobDeclined(jobId, dispatchId);
        if (!declinedResult.success) {
          return { success: false, error: declinedResult.error };
        }
      } else {
        const declinedResult = await handleRegularJobDeclined(jobId);
        if (!declinedResult.success) {
          return { success: false, error: declinedResult.error };
        }
      }
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

export async function handleRegularJobDeclined(jobId: string): Promise<UpdateJobStatusResult> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const autoAllocateResult = await autoAllocateJob(jobId);
    if (autoAllocateResult.success) {
      return { success: true };
    }

    const { error: resetError } = await supabase
      .from('jobs')
      .update({
        status: 'pending',
        assigned_worker_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('tenant_id', tenantId);

    if (resetError) {
      console.error('[handleRegularJobDeclined] reset error:', resetError);
      return { success: false, error: resetError.message ?? 'Failed to return job to pending.' };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: historyError } = await supabase.from('job_status_history').insert({
      job_id: jobId,
      from_status: 'declined',
      to_status: 'pending',
      created_at: new Date().toISOString(),
      changed_by_user_id: user?.id ?? null,
      changed_by_worker_id: null,
      notes: 'Worker declined — returned to pending queue',
      metadata: {},
    });

    if (historyError) {
      console.error('[handleRegularJobDeclined] job_status_history insert error:', historyError);
    }

    revalidatePath('/jobs');
    revalidatePath(`/jobs/${jobId}`);
    return { success: true };
  } catch (err) {
    console.error('[handleRegularJobDeclined]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to handle declined job.',
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

type UnifiedAutoAssignCandidate =
  | {
      type: 'worker';
      id: string;
      name: string;
      lat: number;
      lng: number;
      skills: string[];
      currentLoad: number;
    }
  | {
      type: 'business';
      id: string;
      name: string;
      lat: number;
      lng: number;
      skills: string[];
      currentLoad: number;
      coverageRadiusMiles: number | null;
    };

function parsePointLatLng(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();

  const pointWkt = raw.match(/^POINT\(\s*([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s*\)$/i);
  if (pointWkt) {
    const lng = Number(pointWkt[1]);
    const lat = Number(pointWkt[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  const tuple = raw.match(/^\(\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*\)$/);
  if (tuple) {
    const lng = Number(tuple[1]);
    const lat = Number(tuple[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  return null;
}

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
    const workerIds = workersList.map((w) => w.id);
    let excludedWorkerIds = new Set<string>();
    if (workerIds.length > 0) {
      const { data: workerTenantRows, error: workerTenantError } = await supabase
        .from('worker_tenants')
        .select('worker_id')
        .eq('tenant_id', userData.tenant_id)
        .eq('exclude_from_auto_assign', true)
        .in('worker_id', workerIds);
      if (workerTenantError) {
        console.error('[getRankedWorkersForJob] worker_tenants fetch error:', workerTenantError);
        return { success: false, error: 'Failed to load workers' };
      }
      excludedWorkerIds = new Set((workerTenantRows ?? []).map((r) => r.worker_id as string));
    }

    const eligibleWorkers = workersList.filter((w) => !excludedWorkerIds.has(w.id));

    const { connections, error: connectionsError } = await getConnectionsForTenant(userData.tenant_id);
    if (connectionsError) {
      console.error('[getRankedWorkersForJob] connections fetch error:', connectionsError);
      return { success: false, error: 'Failed to load connected businesses' };
    }
    const activeConnections = connections.filter((c) => c.status === 'active');
    const activeConnectionIds = activeConnections.map((c) => c.id);

    const connectionPointMap = new Map<string, { lat: number; lng: number }>();
    if (activeConnectionIds.length > 0) {
      const { data: connectionRows, error: connectionRowsError } = await supabase
        .from('tenant_network_connections')
        .select('id, coverage_area_centre')
        .in('id', activeConnectionIds);
      if (connectionRowsError) {
        console.error('[getRankedWorkersForJob] connection geometry fetch error:', connectionRowsError);
        return { success: false, error: 'Failed to load connected businesses' };
      }
      for (const row of connectionRows ?? []) {
        const parsed = parsePointLatLng(row.coverage_area_centre);
        if (parsed && row.id) {
          connectionPointMap.set(row.id as string, parsed);
        }
      }
    }

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

    const businessLoadMap = new Map<string, number>();
    if (activeConnectionIds.length > 0) {
      const { data: dispatchCounts, error: dispatchCountsError } = await supabase
        .from('network_job_dispatches')
        .select(
          `
          connection_id,
          canonical_job:jobs!network_job_dispatches_canonical_job_id_fkey(status)
        `
        )
        .in('connection_id', activeConnectionIds)
        .in('canonical_job.status', ['assigned', 'in_progress', 'pending_send']);
      if (dispatchCountsError) {
        console.error('[getRankedWorkersForJob] business load fetch error:', dispatchCountsError);
        return { success: false, error: 'Failed to load connected businesses' };
      }
      for (const row of dispatchCounts ?? []) {
        const connectionId = row.connection_id as string | null;
        if (!connectionId) continue;
        businessLoadMap.set(connectionId, (businessLoadMap.get(connectionId) ?? 0) + 1);
      }
    }

    const sortByDistanceThenLoad = (a: RankedWorkerForJob, b: RankedWorkerForJob) => {
      const da = a.distanceKm ?? Infinity;
      const db = b.distanceKm ?? Infinity;
      if (da !== db) return da - db;
      return a.currentJobs - b.currentJobs;
    };

    const rankedWorkers: RankedWorkerForJob[] = eligibleWorkers.map((w) => {
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

    const rankedBusinesses: RankedWorkerForJob[] = activeConnections
      .map((connection) => {
        const point = connectionPointMap.get(connection.id);
        if (!point) return null;
        const tradeTypes = Array.isArray(connection.trade_types) ? connection.trade_types : [];
        const { matched: matchedRequiredSkills, missing: missingRequiredSkills } =
          requiredSkillBreakdown(requiredSkills, tradeTypes);
        const skillMatch = skillMatchLevelForJob(requiredSkills, tradeTypes);
        const distanceKm = jobCoords
          ? haversineDistance(jobCoords.lat, jobCoords.lng, point.lat, point.lng)
          : null;
        return {
          id: connection.id,
          full_name: connection.other_tenant_name ?? 'Connected business',
          distanceKm,
          currentJobs: businessLoadMap.get(connection.id) ?? 0,
          skillMatch,
          matchedRequiredSkills,
          missingRequiredSkills,
        } satisfies RankedWorkerForJob;
      })
      .filter((row): row is RankedWorkerForJob => row !== null);

    const ranked: RankedWorkerForJob[] = [...rankedWorkers, ...rankedBusinesses];

    if (ranked.length === 0) {
      return { success: true, workers: [], workersNoRequiredSkillMatch: [] };
    }

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

    const workersWithSkills = (workersRaw ?? []).map((worker) => ({
      ...worker,
      parsedSkills: parseWorkerSkillsArray(worker.skills),
    }));
    const workerIds = workersWithSkills.map((w) => w.id);
    let declinedWorkerIds = new Set<string>();
    if (workerIds.length > 0) {
      const { data: declinedRows, error: declinedRowsError } = await supabase
        .from('job_status_history')
        .select('changed_by_worker_id')
        .eq('job_id', jobId)
        .eq('to_status', 'declined')
        .not('changed_by_worker_id', 'is', null)
        .in('changed_by_worker_id', workerIds);
      if (declinedRowsError) {
        console.error('[autoAllocateJob] declined worker history fetch error:', declinedRowsError);
        return await fail('Failed to load workers');
      }
      declinedWorkerIds = new Set((declinedRows ?? []).map((r) => r.changed_by_worker_id as string));
    }
    let excludedWorkerIds = new Set<string>();
    if (workerIds.length > 0) {
      const { data: workerTenantRows, error: workerTenantError } = await supabase
        .from('worker_tenants')
        .select('worker_id')
        .eq('tenant_id', tenantId)
        .eq('exclude_from_auto_assign', true)
        .in('worker_id', workerIds);
      if (workerTenantError) {
        console.error('[autoAllocateJob] worker_tenants fetch error:', workerTenantError);
        return await fail('Failed to load workers');
      }
      excludedWorkerIds = new Set((workerTenantRows ?? []).map((r) => r.worker_id as string));
    }

    // Filter workers who have all required skills (in-memory to avoid JSONB @> serialization issues)
    const workers = workersWithSkills.filter((w) => {
      if (excludedWorkerIds.has(w.id)) return false;
      if (declinedWorkerIds.has(w.id)) return false;
      if (requiredSet.size === 0) return true;
      const workerSet = new Set(w.parsedSkills);
      return [...requiredSet].every((skill) => workerSet.has(skill));
    });

    const { connections, error: connectionsError } = await getConnectionsForTenant(tenantId);
    if (connectionsError) {
      console.error('[autoAllocateJob] connections fetch error:', connectionsError);
      return await fail('Failed to load connected businesses');
    }
    const activeConnections = connections.filter((connection) => connection.status === 'active');
    const activeConnectionIds = activeConnections.map((connection) => connection.id);

    const connectionPointMap = new Map<string, { lat: number; lng: number }>();
    if (activeConnectionIds.length > 0) {
      const { data: connectionRows, error: connectionRowsError } = await supabase
        .from('tenant_network_connections')
        .select('id, coverage_area_centre')
        .in('id', activeConnectionIds);
      if (connectionRowsError) {
        console.error('[autoAllocateJob] connection geometry fetch error:', connectionRowsError);
        return await fail('Failed to load connected businesses');
      }
      for (const row of connectionRows ?? []) {
        const parsed = parsePointLatLng(row.coverage_area_centre);
        if (parsed && row.id) {
          connectionPointMap.set(row.id as string, parsed);
        }
      }
    }

    const businesses = activeConnections.filter((connection) => {
      const point = connectionPointMap.get(connection.id);
      if (!point) return false;
      const tradeTypes = Array.isArray(connection.trade_types) ? connection.trade_types : [];
      if (requiredSet.size === 0) return true;
      const tradeSet = new Set(tradeTypes);
      return [...requiredSet].every((skill) => tradeSet.has(skill));
    });

    if (workers.length === 0 && businesses.length === 0) {
      const message =
        requiredSkills.length > 0
          ? `No workers or connected businesses with required skills: ${requiredSkills.join(', ')}`
          : 'No available workers or connected businesses';
      return await fail(message);
    }

    console.log('[autoAllocateJob] worker count found:', workers.length);
    console.log('[autoAllocateJob] business count found:', businesses.length);

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

    const businessLoadMap = new Map<string, number>();
    if (activeConnectionIds.length > 0) {
      const { data: dispatchCounts, error: dispatchCountsError } = await supabase
        .from('network_job_dispatches')
        .select(
          `
          connection_id,
          canonical_job:jobs!network_job_dispatches_canonical_job_id_fkey(status)
        `
        )
        .in('connection_id', activeConnectionIds)
        .in('canonical_job.status', ['assigned', 'in_progress', 'pending_send']);
      if (dispatchCountsError) {
        console.error('[autoAllocateJob] business load fetch error:', dispatchCountsError);
        return await fail('Failed to load connected businesses');
      }
      for (const row of dispatchCounts ?? []) {
        const connectionId = row.connection_id as string | null;
        if (!connectionId) continue;
        businessLoadMap.set(connectionId, (businessLoadMap.get(connectionId) ?? 0) + 1);
      }
    }

    const workerCandidates: UnifiedAutoAssignCandidate[] = workers
      .filter((worker) => Number.isFinite(Number(worker.home_lat)) && Number.isFinite(Number(worker.home_lng)))
      .map((worker) => ({
        type: 'worker',
        id: worker.id,
        name: worker.full_name,
        lat: Number(worker.home_lat),
        lng: Number(worker.home_lng),
        skills: worker.parsedSkills,
        currentLoad: jobCountMap.get(worker.id) ?? 0,
      }));

    const businessCandidates: UnifiedAutoAssignCandidate[] = businesses.flatMap((business) => {
      const point = connectionPointMap.get(business.id);
      if (!point) return [];
      return [
        {
          type: 'business',
          id: business.id,
          name: business.other_tenant_name ?? 'Connected business',
          lat: point.lat,
          lng: point.lng,
          skills: business.trade_types ?? [],
          coverageRadiusMiles: business.coverage_radius_miles,
          currentLoad: businessLoadMap.get(business.id) ?? 0,
        } satisfies UnifiedAutoAssignCandidate,
      ];
    });

    const rankedCandidates = [...workerCandidates, ...businessCandidates]
      .map((candidate) => ({
        ...candidate,
        distance: haversineDistance(jobCoords.lat, jobCoords.lng, candidate.lat, candidate.lng),
      }))
      .sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.currentLoad - b.currentLoad;
      });

    const bestCandidate = rankedCandidates[0];
    console.log('[autoAllocateJob] selected candidate', {
      id: bestCandidate.id,
      name: bestCandidate.name,
      type: bestCandidate.type,
      distance: Math.round(bestCandidate.distance * 10) / 10,
      currentLoad: bestCandidate.currentLoad,
    });

    if (bestCandidate.type === 'business') {
      const dispatchResult = await dispatchJobToNetwork(jobId, bestCandidate.id);
      if (!dispatchResult.success) {
        return await fail(dispatchResult.error ?? 'Failed to dispatch to connected business');
      }
    } else {
      const assignResult = await assignJob(jobId, bestCandidate.id, { pendingSend: true });
      if (!assignResult.success) {
        return await fail(assignResult.error ?? 'Failed to assign worker');
      }
    }

    return {
      success: true,
      workerId: bestCandidate.id,
      workerName: bestCandidate.name,
      distance: Math.round(bestCandidate.distance * 10) / 10,
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
