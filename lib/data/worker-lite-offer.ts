import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { checkWorkerLiteGate } from '@/lib/billing/worker-lite';

export type WorkerLiteOffer = { employerName: string } | null;

/**
 * The Lite offer for a self-employed worker: present only for the admin of a business made from a worker invite,
 * whose link to a live Pro business is real and who does not have Lite yet. Employees, office admins, Rounds and
 * Lite owners always get null. One read per request; any failure means no offer.
 */
export const getWorkerLiteOffer = cache(async (): Promise<WorkerLiteOffer> => {
  try {
    const { user } = await getAuthUser();
    if (!user) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from('users')
      .select('role, tenant_id')
      .eq('id', user.id)
      .maybeSingle<{ role: string | null; tenant_id: string | null }>();
    if (!data || data.role !== 'admin' || !data.tenant_id) return null;

    const gate = await checkWorkerLiteGate(data.tenant_id);
    return gate.ok ? { employerName: gate.employerName } : null;
  } catch {
    return null;
  }
});
