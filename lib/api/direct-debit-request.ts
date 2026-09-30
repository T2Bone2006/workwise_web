import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  requireRoundsApi,
  roundsJson,
  type RoundsApiContext,
} from '@/lib/api/rounds-request';
import { tenantHasRounds } from '@/lib/messaging/rounds-tenants';
import { isTenantAdmin } from '@/lib/stripe/connect';
import { createAdminClient } from '@/lib/supabase/admin';

export type DirectDebitApiContext = RoundsApiContext & { admin: SupabaseClient };

const ALREADY_SORTED = 'This has already been sorted.';

/**
 * Bearer login → tenant → Rounds subscription → (act) account owner, in that
 * order. The tenant only ever comes from the token.
 * Refusals: 401 Unauthorised · 403 Forbidden · 403 'Rounds only.' · 403 'Only the account owner can do this.'
 */
export async function requireDirectDebitApi(
  request: Request,
  mode: 'read' | 'act',
): Promise<{ ok: true; ctx: DirectDebitApiContext } | { ok: false; response: NextResponse }> {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  try {
    if (!(await tenantHasRounds(admin, auth.ctx.tenantId))) {
      return { ok: false, response: roundsJson({ error: 'Rounds only.' }, 403) };
    }
    if (mode === 'act' && !(await isTenantAdmin(auth.ctx.supabase, auth.ctx.userId))) {
      return {
        ok: false,
        response: roundsJson({ error: 'Only the account owner can do this.' }, 403),
      };
    }
  } catch (err) {
    console.error('[direct-debit api] guard', err instanceof Error ? err.name : 'error');
    return { ok: false, response: roundsJson({ error: 'Something went wrong.' }, 500) };
  }
  return { ok: true, ctx: { ...auth.ctx, admin } };
}

/** A route `[id]` param that must be a uuid. */
export function parseUuidParam(raw: string): { ok: true; id: string } | { ok: false; response: NextResponse } {
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) return { ok: false, response: roundsJson({ error: 'Invalid id.' }, 400) };
  return { ok: true, id: parsed.data };
}

/** A core's refusal → 400 (409 when someone else already sorted it). */
export function coreError(error: string): NextResponse {
  return roundsJson({ error }, error === ALREADY_SORTED ? 409 : 400);
}

/** Unexpected throws → 500, logged with the route name only. */
export function unexpected(route: string, err: unknown): NextResponse {
  console.error(`[${route}]`, err instanceof Error ? err.name : 'error');
  return roundsJson({ error: 'Something went wrong.' }, 500);
}
