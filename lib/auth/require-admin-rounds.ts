import 'server-only';

import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isTenantAdmin } from '@/lib/stripe/connect';
import { createClient } from '@/lib/supabase/server';

export const OWNER_ONLY = 'Only the account owner can do this.';

export type AdminRoundsContext =
  | {
      success: true;
      tenantId: string;
      userId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
  | { success: false; error: string };

/**
 * The guard for dashboard actions that are for the account owner of a Rounds
 * business only: signed in, has Rounds, is an admin. The tenant only ever comes
 * from the session, never from the caller.
 */
export async function requireAdminRounds(notRoundsMessage: string): Promise<AdminRoundsContext> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds) return { success: false, error: notRoundsMessage };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { success: false, error: 'Not signed in' };
  if (!(await isTenantAdmin(supabase, user.id))) return { success: false, error: OWNER_ONLY };

  return { success: true, tenantId, userId: user.id, supabase };
}
