import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  requireRoundsApi,
  roundsJson,
  type RoundsApiContext,
} from '@/lib/api/rounds-request';
import { tenantHasRounds } from '@/lib/messaging/rounds-tenants';
import { isTenantAdmin } from '@/lib/stripe/connect';
import { createAdminClient } from '@/lib/supabase/admin';

export type ExpensesApiContext = RoundsApiContext & { admin: SupabaseClient };

/**
 * Bearer login → tenant → Rounds subscription → account owner, in that order.
 * Same as requireDirectDebitApi(request, 'act'). The tenant only ever comes
 * from the token. Expenses are owner-only, so reads use this guard too.
 * Refusals: 401 Unauthorised · 403 Forbidden · 403 'Expenses are part of Rounds.' · 403 'Only the account owner can do this.'
 */
export async function requireExpensesApi(
  request: Request,
): Promise<{ ok: true; ctx: ExpensesApiContext } | { ok: false; response: NextResponse }> {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  try {
    if (!(await tenantHasRounds(admin, auth.ctx.tenantId))) {
      return { ok: false, response: roundsJson({ error: 'Expenses are part of Rounds.' }, 403) };
    }
    if (!(await isTenantAdmin(auth.ctx.supabase, auth.ctx.userId))) {
      return {
        ok: false,
        response: roundsJson({ error: 'Only the account owner can do this.' }, 403),
      };
    }
  } catch (err) {
    console.error('[expenses api] guard', err instanceof Error ? err.name : 'error');
    return { ok: false, response: roundsJson({ error: 'Something went wrong.' }, 500) };
  }
  return { ok: true, ctx: { ...auth.ctx, admin } };
}
