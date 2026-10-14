import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantSettings } from '@/lib/data/settings-types';
import { sendExpoPushMessages } from '@/lib/services/expo-push';

export async function sendJobAssignedPushToWorker(params: {
  supabase: SupabaseClient;
  tenantId: string;
  workerId: string;
  jobId: string;
  referenceNumber: string;
}): Promise<void> {
  const { data: tenant } = await params.supabase
    .from('tenants')
    .select('settings')
    .eq('id', params.tenantId)
    .single();

  const settings = tenant?.settings as TenantSettings | undefined;
  if (settings?.notifications?.worker?.push_when_job_assigned === false) {
    return;
  }

  const { data: worker } = await params.supabase
    .from('workers')
    .select('expo_push_token')
    .eq('id', params.workerId)
    .maybeSingle();

  await sendJobsAssignedPushToWorker({
    token: typeof worker?.expo_push_token === 'string' ? worker.expo_push_token : null,
    jobs: [{ jobId: params.jobId, referenceNumber: params.referenceNumber }],
  });
}

/** One notification for every job in this send, not one per job. */
export async function sendJobsAssignedPushToWorker(params: {
  token: string | null;
  jobs: readonly { jobId: string; referenceNumber: string }[];
}): Promise<void> {
  const token = params.token?.trim() ?? '';
  const jobs = params.jobs;
  if (!token || jobs.length === 0) return;

  const only = jobs.length === 1 ? jobs[0] : null;
  await sendExpoPushMessages([
    {
      to: token,
      title: only ? 'New job assigned' : `${jobs.length} new jobs`,
      body: only
        ? `${only.referenceNumber} — open the app for details.`
        : 'Open the app to see them.',
      data: only
        ? { jobId: only.jobId, job_id: only.jobId, type: 'job_assigned' }
        : { type: 'job_assigned' },
      sound: 'default',
    },
  ]);
}
