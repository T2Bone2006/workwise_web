import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClientFromBearer } from '@/lib/auth/bearer';
import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS, type Product } from '@/lib/data/tenant-products';
import { todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/** Everything a tool needs. `db` acts as the trader (RLS); `admin` is for the assistant's own tables and Lite rows. */
export type AssistantCtx = {
  db: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  hasRounds: boolean;
  hasLite: boolean;
  /** Any Pro tier (a dispatch office: jobs, workers, customers). Only offered on the new look. */
  hasPro: boolean;
  surface: 'web' | 'phone';
  today: Ymd;
};

type Failure = { ok: false; response: NextResponse };

/** Whether this login's plan covers a tool or action ('any' is always covered). */
export function covers(ctx: Pick<AssistantCtx, 'hasRounds' | 'hasLite' | 'hasPro'>, product: 'rounds' | 'lite' | 'pro' | 'any'): boolean {
  return product === 'any' || (product === 'rounds' ? ctx.hasRounds : product === 'lite' ? ctx.hasLite : ctx.hasPro);
}

function fail(status: number, error: string): Failure {
  return {
    ok: false,
    response: NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } }),
  };
}

/**
 * The account owner of a Rounds, Lite and/or Pro business, from the phone's
 * bearer token or the dashboard's cookie. Pro workers never get it (they are not
 * admins). A Pro office gets it like any other business (there is no look switch any more).
 */
export async function requireAssistantCaller(
  request: Request,
): Promise<{ ok: true; ctx: AssistantCtx } | Failure> {
  let db: SupabaseClient;
  let userId: string;
  let surface: 'web' | 'phone';

  const bearer = await createClientFromBearer(request);
  if (bearer) {
    db = bearer.supabase;
    userId = bearer.userId;
    surface = 'phone';
  } else {
    const cookieClient = await createClient();
    const {
      data: { user },
    } = await cookieClient.auth.getUser();
    if (!user?.id) return fail(401, 'Unauthorised');
    db = cookieClient;
    userId = user.id;
    surface = 'web';
  }

  const { data: userRow } = await db
    .from('users')
    .select('role, tenant_id')
    .eq('id', userId)
    .maybeSingle();
  const row = userRow as { role?: unknown; tenant_id?: unknown } | null;
  if (row?.role !== 'admin' || typeof row.tenant_id !== 'string' || row.tenant_id === '') {
    return fail(403, 'Forbidden');
  }
  const tenantId = row.tenant_id;

  const admin = createAdminClient();
  const { data: subs, error } = await admin
    .from('subscriptions')
    .select('product')
    .eq('tenant_id', tenantId)
    .in('status', [...ENTITLED_STATUSES]);
  if (error) {
    console.error('[requireAssistantCaller] subscriptions', error.message);
    return fail(503, 'Try again in a moment');
  }
  const products = new Set((subs ?? []).map((s) => (s as { product: Product }).product));
  const hasPro = PRO_TIER_PRODUCTS.some((p) => products.has(p));
  const hasRounds = products.has('rounds');
  const hasLite = products.has('lite');
  if (!hasRounds && !hasLite && !hasPro) return fail(403, 'plan_ended');

  return {
    ok: true,
    ctx: { db, admin, tenantId, userId, hasRounds, hasLite, hasPro, surface, today: todayInLondon() },
  };
}
