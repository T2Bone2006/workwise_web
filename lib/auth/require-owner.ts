import 'server-only';

import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callerIsOwner } from '@/lib/api/owner-guard';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { createClient } from '@/lib/supabase/server';

export const NOT_SIGNED_IN = 'Not signed in';
export const OWNER_ONLY_MESSAGE = 'Only the account owner can do this.';

export type OwnerContext =
  | { ok: true; tenantId: string; userId: string; supabase: SupabaseClient }
  | { ok: false; error: string };

/**
 * The signed-in account owner (users.role = 'admin') and their business, for server actions.
 * The tenant only ever comes from the session. A member of staff (role 'worker') gets
 * { ok: false } even though they belong to the same business.
 */
export async function requireOwner(): Promise<OwnerContext> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { ok: false, error: NOT_SIGNED_IN };

  const { user } = await getAuthUser();
  if (!user?.id) return { ok: false, error: NOT_SIGNED_IN };

  const supabase = await createClient();
  if (!(await callerIsOwner(supabase, user.id))) return { ok: false, error: OWNER_ONLY_MESSAGE };

  return { ok: true, tenantId, userId: user.id, supabase };
}

/**
 * Drop-in for getTenantIdForCurrentUser() in server actions: the business id, but only for the
 * account owner. Anyone else (a Rounds member of staff, a Pro employee) gets null, which every
 * action already treats as "not allowed", so one import swap closes the action to staff.
 */
export const getOwnerTenantId = cache(async (): Promise<string | null> => {
  const owner = await requireOwner();
  return owner.ok ? owner.tenantId : null;
});
