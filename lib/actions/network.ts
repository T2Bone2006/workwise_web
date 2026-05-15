'use server';

import { revalidatePath } from 'next/cache';
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

type ConnectionRow = {
  id: string;
  tenant_id_a: string;
  tenant_id_b: string;
  invited_by_tenant_id: string | null;
  invited_by_user_id: string | null;
  status: string | null;
};

type DispatchRow = {
  id: string;
  canonical_job_id: string | null;
  connection_id: string | null;
  originating_tenant_id: string | null;
  receiving_tenant_id: string | null;
  originating_reference_number?: string | null;
  created_at: string | null;
};

function getOtherParticipantTenantId(connection: ConnectionRow, tenantId: string): string | null {
  if (connection.tenant_id_a === tenantId) return connection.tenant_id_b;
  if (connection.tenant_id_b === tenantId) return connection.tenant_id_a;
  return null;
}

async function getCurrentTenantAndUser() {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return { tenantId: null, userId: null, error: 'No tenant assigned.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { tenantId: null, userId: null, error: 'Not authenticated.' };
  }

  return { tenantId, userId: user.id, error: null };
}

export async function createConnection(
  inviteEmail: string,
  message?: string
): Promise<ActionResult<ConnectionRow>> {
  try {
    const trimmedEmail = inviteEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      return { success: false, error: 'Invite email is required.' };
    }

    const session = await getCurrentTenantAndUser();
    if (session.error || !session.tenantId || !session.userId) {
      return { success: false, error: session.error ?? 'Unable to resolve current user.' };
    }

    const supabase = await createClient();
    const adminSupabase = createSupabaseAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: invitedUser, error: invitedUserError } = await adminSupabase
      .from('users')
      .select('tenant_id')
      .eq('email', trimmedEmail)
      .maybeSingle();

    if (invitedUserError) {
      console.error('[createConnection] invited user lookup:', invitedUserError);
      return { success: false, error: invitedUserError.message ?? 'Failed to resolve invited business.' };
    }

    const invitedTenantId = invitedUser?.tenant_id as string | null;
    if (!invitedTenantId) {
      return { success: false, error: 'No business account found for this email.' };
    }
    if (invitedTenantId === session.tenantId) {
      return { success: false, error: 'You cannot create a connection with your own business.' };
    }

    const { data, error } = await supabase
      .from('tenant_network_connections')
      .insert({
        tenant_id_a: session.tenantId,
        tenant_id_b: invitedTenantId,
        invited_by_tenant_id: session.tenantId,
        invited_by_user_id: session.userId,
        invite_email: trimmedEmail,
        message: message?.trim() || null,
        status: 'pending',
      })
      .select('id, tenant_id_a, tenant_id_b, invited_by_tenant_id, invited_by_user_id, status')
      .single();

    if (error || !data) {
      console.error('[createConnection]', error);
      return { success: false, error: error?.message ?? 'Failed to create connection.' };
    }

    revalidatePath('/network');
    return { success: true, data: data as ConnectionRow };
  } catch (err) {
    console.error('[createConnection]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to create connection.',
    };
  }
}

export async function respondToConnection(
  connectionId: string,
  accept: boolean
): Promise<ActionResult<ConnectionRow>> {
  try {
    const session = await getCurrentTenantAndUser();
    if (session.error || !session.tenantId) {
      return { success: false, error: session.error ?? 'Unable to resolve current tenant.' };
    }

    const supabase = await createClient();
    const { data: connection, error: fetchError } = await supabase
      .from('tenant_network_connections')
      .select('id, tenant_id_a, tenant_id_b, invited_by_tenant_id, invited_by_user_id, status')
      .eq('id', connectionId)
      .maybeSingle();

    if (fetchError || !connection) {
      return { success: false, error: 'Connection not found or access denied.' };
    }

    const row = connection as ConnectionRow;
    const isParticipant = row.tenant_id_a === session.tenantId || row.tenant_id_b === session.tenantId;
    if (!isParticipant) {
      return { success: false, error: 'Connection not found or access denied.' };
    }
    if (row.invited_by_tenant_id === session.tenantId) {
      return { success: false, error: 'Only the invited business can respond to this request.' };
    }

    const { data: updated, error: updateError } = await supabase
      .from('tenant_network_connections')
      .update({
        status: accept ? 'active' : 'rejected',
        responded_at: new Date().toISOString(),
      })
      .eq('id', connectionId)
      .select('id, tenant_id_a, tenant_id_b, invited_by_tenant_id, invited_by_user_id, status')
      .single();

    if (updateError || !updated) {
      console.error('[respondToConnection]', updateError);
      return { success: false, error: updateError?.message ?? 'Failed to update connection.' };
    }

    revalidatePath('/network');
    return { success: true, data: updated as ConnectionRow };
  } catch (err) {
    console.error('[respondToConnection]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to respond to connection.',
    };
  }
}

export async function revokeConnection(connectionId: string): Promise<ActionResult<{ id: string; status: string }>> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: connection, error: fetchError } = await supabase
      .from('tenant_network_connections')
      .select('id, tenant_id_a, tenant_id_b')
      .eq('id', connectionId)
      .maybeSingle();

    if (fetchError || !connection) {
      return { success: false, error: 'Connection not found or access denied.' };
    }

    const isParticipant =
      (connection.tenant_id_a as string | null) === tenantId ||
      (connection.tenant_id_b as string | null) === tenantId;
    if (!isParticipant) {
      return { success: false, error: 'Connection not found or access denied.' };
    }

    const { data: updated, error: updateError } = await supabase
      .from('tenant_network_connections')
      .update({
        status: 'revoked',
      })
      .eq('id', connectionId)
      .select('id, status')
      .single();

    if (updateError || !updated) {
      console.error('[revokeConnection]', updateError);
      return { success: false, error: updateError?.message ?? 'Failed to revoke connection.' };
    }

    revalidatePath('/network');
    return { success: true, data: { id: updated.id as string, status: updated.status as string } };
  } catch (err) {
    console.error('[revokeConnection]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to revoke connection.',
    };
  }
}

export async function updateConnectionSettings(
  connectionId: string,
  settings: { trade_types: string[]; coverage_radius_miles: number }
): Promise<ActionResult<{ id: string; trade_types: string[]; coverage_radius_miles: number }>> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: connection, error: fetchError } = await supabase
      .from('tenant_network_connections')
      .select('id, tenant_id_a, tenant_id_b')
      .eq('id', connectionId)
      .maybeSingle();

    if (fetchError || !connection) {
      return { success: false, error: 'Connection not found or access denied.' };
    }

    const isParticipant =
      (connection.tenant_id_a as string | null) === tenantId ||
      (connection.tenant_id_b as string | null) === tenantId;
    if (!isParticipant) {
      return { success: false, error: 'Connection not found or access denied.' };
    }

    const tradeTypes = Array.isArray(settings.trade_types) ? settings.trade_types : [];
    const radius =
      typeof settings.coverage_radius_miles === 'number' &&
      Number.isFinite(settings.coverage_radius_miles) &&
      settings.coverage_radius_miles >= 0
        ? settings.coverage_radius_miles
        : 0;

    const { data: updated, error: updateError } = await supabase
      .from('tenant_network_connections')
      .update({
        trade_types: tradeTypes,
        coverage_radius_miles: radius,
      })
      .eq('id', connectionId)
      .select('id, trade_types, coverage_radius_miles')
      .single();

    if (updateError || !updated) {
      console.error('[updateConnectionSettings]', updateError);
      return { success: false, error: updateError?.message ?? 'Failed to update connection settings.' };
    }

    revalidatePath('/network');
    return {
      success: true,
      data: {
        id: updated.id as string,
        trade_types: Array.isArray(updated.trade_types) ? (updated.trade_types as string[]) : [],
        coverage_radius_miles: Number(updated.coverage_radius_miles ?? 0),
      },
    };
  } catch (err) {
    console.error('[updateConnectionSettings]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to update connection settings.',
    };
  }
}

export async function dispatchJobToNetwork(
  jobId: string,
  connectionId: string,
  notes?: string
): Promise<ActionResult<DispatchRow>> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();

    const { data: connection, error: connectionError } = await supabase
      .from('tenant_network_connections')
      .select('id, tenant_id_a, tenant_id_b, invited_by_tenant_id, invited_by_user_id, status')
      .eq('id', connectionId)
      .maybeSingle();

    if (connectionError || !connection) {
      return { success: false, error: 'Connection not found or access denied.' };
    }

    const connectionRow = connection as ConnectionRow;
    const receivingTenantId = getOtherParticipantTenantId(connectionRow, tenantId);
    if (!receivingTenantId) {
      return { success: false, error: 'Connection not found or access denied.' };
    }
    if (connectionRow.status !== 'active') {
      return { success: false, error: 'Connection must be active before dispatching jobs.' };
    }

    const { data: sourceJob, error: sourceJobError } = await supabase
      .from('jobs')
      .select(
        `
        id,
        tenant_id,
        customer_id,
        reference_number,
        address,
        postcode,
        lat,
        lng,
        job_description,
        required_skills,
        scheduled_date,
        scheduled_time,
        priority
      `
      )
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (sourceJobError || !sourceJob) {
      return { success: false, error: 'Job not found or access denied.' };
    }

    let originatingCustomerSnapshot: Record<string, unknown> | null = null;
    if (sourceJob.customer_id) {
      const { data: customer } = await supabase
        .from('customers')
        .select('id, name, contact_person, email, phone, type, company_name')
        .eq('id', sourceJob.customer_id as string)
        .maybeSingle();
      if (customer) {
        originatingCustomerSnapshot = customer as Record<string, unknown>;
      }
    }

    const { data: dispatch, error: dispatchError } = await supabase
      .from('network_job_dispatches')
      .insert({
        connection_id: connectionId,
        canonical_job_id: sourceJob.id,
        originating_tenant_id: tenantId,
        receiving_tenant_id: receivingTenantId,
        originating_reference_number: sourceJob.reference_number,
        originating_customer_snapshot: originatingCustomerSnapshot,
        notes: notes?.trim() || null,
      })
      .select('id, canonical_job_id, connection_id, originating_tenant_id, receiving_tenant_id, created_at')
      .single();

    if (dispatchError || !dispatch) {
      console.error('[dispatchJobToNetwork] dispatch insert', dispatchError);
      return { success: false, error: dispatchError?.message ?? 'Failed to create network dispatch.' };
    }

    const { error: mirroredJobError } = await supabase.from('jobs').insert({
      tenant_id: receivingTenantId,
      reference_number: sourceJob.reference_number,
      customer_id: null,
      address: sourceJob.address,
      postcode: sourceJob.postcode,
      lat: sourceJob.lat,
      lng: sourceJob.lng,
      job_description: sourceJob.job_description,
      required_skills: sourceJob.required_skills,
      scheduled_date: sourceJob.scheduled_date,
      scheduled_time: sourceJob.scheduled_time,
      priority: sourceJob.priority,
      status: 'pending_send',
      network_dispatch_id: dispatch.id,
    });

    if (mirroredJobError) {
      console.error('[dispatchJobToNetwork] mirrored job insert', mirroredJobError);
      return { success: false, error: mirroredJobError.message ?? 'Failed to create receiving tenant job.' };
    }

    revalidatePath('/jobs');
    revalidatePath('/network');
    return { success: true, data: dispatch as DispatchRow };
  } catch (err) {
    console.error('[dispatchJobToNetwork]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to dispatch job to network.',
    };
  }
}

export async function handleNetworkJobDeclined(
  jobId: string,
  dispatchId: string
): Promise<ActionResult<{ newJobId: string }>> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();

    const { data: declinedJob, error: declinedJobError } = await supabase
      .from('jobs')
      .select(
        `
        id,
        tenant_id,
        address,
        postcode,
        lat,
        lng,
        job_description,
        required_skills,
        scheduled_date,
        scheduled_time,
        priority
      `
      )
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (declinedJobError || !declinedJob) {
      return { success: false, error: 'Declined job not found or access denied.' };
    }

    const { data: dispatch, error: dispatchError } = await supabase
      .from('network_job_dispatches')
      .select('id, originating_tenant_id, receiving_tenant_id, originating_reference_number')
      .eq('id', dispatchId)
      .maybeSingle();

    if (dispatchError || !dispatch) {
      return { success: false, error: 'Network dispatch not found.' };
    }

    if ((dispatch.receiving_tenant_id as string | null) !== tenantId) {
      return { success: false, error: 'Network dispatch not found or access denied.' };
    }

    if (!dispatch.originating_tenant_id) {
      return { success: false, error: 'Dispatch is missing originating tenant details.' };
    }

    const { data: newJob, error: insertError } = await supabase
      .from('jobs')
      .insert({
        tenant_id: dispatch.originating_tenant_id,
        reference_number: dispatch.originating_reference_number ?? null,
        customer_id: null,
        address: declinedJob.address,
        postcode: declinedJob.postcode,
        lat: declinedJob.lat,
        lng: declinedJob.lng,
        job_description: declinedJob.job_description,
        required_skills: declinedJob.required_skills,
        scheduled_date: declinedJob.scheduled_date,
        scheduled_time: declinedJob.scheduled_time,
        priority: declinedJob.priority,
        status: 'declined',
        network_dispatch_id: null,
      })
      .select('id')
      .single();

    if (insertError || !newJob?.id) {
      console.error('[handleNetworkJobDeclined] new job insert', insertError);
      return { success: false, error: insertError?.message ?? 'Failed to return network job.' };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: historyError } = await supabase.from('job_status_history').insert({
      job_id: newJob.id,
      from_status: null,
      to_status: 'pending',
      created_at: new Date().toISOString(),
      changed_by_user_id: user?.id ?? null,
      changed_by_worker_id: null,
      notes: 'Returned from network — dispatch declined',
      metadata: {},
    });

    if (historyError) {
      console.error('[handleNetworkJobDeclined] job_status_history insert error:', historyError);
    }

    revalidatePath('/monitor');
    revalidatePath('/jobs');

    return { success: true, data: { newJobId: newJob.id } };
  } catch (err) {
    console.error('[handleNetworkJobDeclined]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to handle network decline.',
    };
  }
}

export async function declineEntireDispatch(
  dispatchId: string
): Promise<ActionResult<{ success: number; failed: number; errors: string[] }>> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('network_dispatch_id', dispatchId);

    if (jobsError) {
      console.error('[declineEntireDispatch] jobs lookup', jobsError);
      return { success: false, error: jobsError.message ?? 'Failed to load dispatch jobs.' };
    }

    const dispatchJobs = Array.isArray(jobs) ? jobs : [];
    if (dispatchJobs.length === 0) {
      return { success: false, error: 'No jobs found for this dispatch.' };
    }

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const job of dispatchJobs) {
      const jobId = (job.id as string | null) ?? null;
      if (!jobId) {
        failedCount += 1;
        errors.push('Unknown job: missing id');
        continue;
      }

      const result = await handleNetworkJobDeclined(jobId, dispatchId);
      if (result.success) {
        successCount += 1;
      } else {
        failedCount += 1;
        errors.push(`${jobId.slice(0, 8)}: ${result.error}`);
      }
    }

    if (successCount === 0) {
      return { success: false, error: errors[0] ?? 'Failed to decline dispatch.' };
    }

    revalidatePath('/network');
    revalidatePath('/jobs');
    revalidatePath('/monitor');

    return {
      success: true,
      data: {
        success: successCount,
        failed: failedCount,
        errors,
      },
    };
  } catch (err) {
    console.error('[declineEntireDispatch]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to decline entire dispatch.',
    };
  }
}

export async function bulkDispatchToNetwork(
  jobIds: string[],
  connectionId: string
): Promise<ActionResult<{ success: number; failed: number; errors: string[] }>> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const uniqueJobIds = Array.from(
      new Set(jobIds.map((id) => id.trim()).filter((id) => id.length > 0))
    );
    if (uniqueJobIds.length === 0) {
      return { success: false, error: 'No jobs selected for dispatch.' };
    }

    const supabase = await createClient();
    const { data: connection, error: connectionError } = await supabase
      .from('tenant_network_connections')
      .select('id, tenant_id_a, tenant_id_b, invited_by_tenant_id, invited_by_user_id, status')
      .eq('id', connectionId)
      .maybeSingle();

    if (connectionError || !connection) {
      return { success: false, error: 'Connection not found or access denied.' };
    }

    const connectionRow = connection as ConnectionRow;
    const isParticipant =
      connectionRow.tenant_id_a === tenantId || connectionRow.tenant_id_b === tenantId;
    if (!isParticipant) {
      return { success: false, error: 'Connection not found or access denied.' };
    }
    if (connectionRow.status !== 'active') {
      return { success: false, error: 'Connection must be active before dispatching jobs.' };
    }

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const jobId of uniqueJobIds) {
      const result = await dispatchJobToNetwork(jobId, connectionId);
      if (result.success) {
        successCount += 1;
      } else {
        failedCount += 1;
        errors.push(`${jobId.slice(0, 8)}: ${result.error}`);
      }
    }

    revalidatePath('/jobs');
    revalidatePath('/monitor');

    return {
      success: true,
      data: {
        success: successCount,
        failed: failedCount,
        errors,
      },
    };
  } catch (err) {
    console.error('[bulkDispatchToNetwork]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to bulk dispatch jobs to network.',
    };
  }
}
