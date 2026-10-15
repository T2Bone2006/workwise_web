import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import {
  buildWorkerLink,
  pickWorkerRow,
  type WorkerLink,
  type WorkerRowLite,
} from '@/lib/auth/worker-link-core';

export type { WorkerLink } from '@/lib/auth/worker-link-core';

/**
 * The signed-in login's link to an employer, or null. Read with the user's own
 * session (their own workers row is readable by them), once per request. A read
 * that fails is "not a worker": it never grants anything.
 */
export const getWorkerLink = cache(async (): Promise<WorkerLink | null> => {
  try {
    const { user } = await getAuthUser();
    if (!user) return null;

    const supabase = await createClient();
    const [{ data: rows, error }, { data: profile }] = await Promise.all([
      supabase
        .from('workers')
        .select('id, worker_type, primary_tenant_id, invite_status, updated_at')
        .eq('user_id', user.id)
        .returns<WorkerRowLite[]>(),
      supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle<{ tenant_id: string | null }>(),
    ]);
    if (error || !rows) {
      if (error) console.error('[worker-link] workers read failed');
      return null;
    }

    const row = pickWorkerRow(rows);
    if (!row) return null;

    // The name only decorates the page; if the employer's row can't be read the link still counts.
    const { data: employer } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', row.primary_tenant_id as string)
      .maybeSingle<{ name: string | null }>();

    return buildWorkerLink({
      row,
      usersTenantId: profile?.tenant_id ?? null,
      employerName: employer?.name ?? null,
    });
  } catch (err) {
    console.error('[worker-link]', err instanceof Error ? err.name : 'Error');
    return null;
  }
});
