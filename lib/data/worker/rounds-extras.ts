import 'server-only';

import { cache } from 'react';
import { resolveStaffContext } from '@/lib/api/staff-request';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStaffCash } from '@/lib/team/staff-cash';
import { NOT_ROUNDS, firstNameOf, shapeHeldCash, type WorkerRoundsExtras } from './rounds-extras-core';

export type { WorkerRoundsExtras } from './rounds-extras-core';

/**
 * Whether the signed-in login is a live lead of a Rounds business, and what they hold. Uses the same check as the
 * phone's staff API (resolveStaffContext), on the verified session user: it never takes a worker or business from the
 * request. Once per request. Any problem is "not a Rounds lead": the page then looks exactly like a Pro employee's.
 */
export const getWorkerRoundsExtras = cache(async (): Promise<WorkerRoundsExtras> => {
  try {
    const { user } = await getAuthUser();
    if (!user?.id) return NOT_ROUNDS;
    const db = createAdminClient();
    const staff = await resolveStaffContext(db, user.id);
    if (!staff.ok) return NOT_ROUNDS;
    const { tenantId, workerId } = staff.ctx;

    const [cash, owner, tenant] = await Promise.all([
      getStaffCash(db, { tenantId, workerId }).catch(() => null),
      db.from('users').select('full_name').eq('tenant_id', tenantId).eq('role', 'admin').limit(1).maybeSingle(),
      db.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    const ownerName = firstNameOf((owner.data as { full_name?: string | null } | null)?.full_name);
    const business = (tenant.data as { name?: string | null } | null)?.name?.trim() || null;
    return {
      employerIsRounds: true,
      handToName: ownerName ?? business,
      heldCash: cash ? shapeHeldCash(cash.held, cash.heldTotal) : null,
    };
  } catch (err) {
    console.error('[worker rounds extras]', err instanceof Error ? err.name : 'error');
    return NOT_ROUNDS;
  }
});
