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

  const token = typeof worker?.expo_push_token === 'string' ? worker.expo_push_token.trim() : '';
  if (!token) {
    return;
  }

  await sendExpoPushMessages([
    {
      to: token,
      title: 'New job assigned',
      body: `${params.referenceNumber} — open the app for details.`,
      data: { jobId: params.jobId, type: 'job_assigned' },
      sound: 'default',
    },
  ]);
}
