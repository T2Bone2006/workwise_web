import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClientFromBearer } from '@/lib/auth/bearer';
import { pickWorkerRow, type WorkerRowLite } from '@/lib/auth/worker-link-core';
import { hasProTier } from '@/lib/billing/worker-gate';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The guard for /api/staff/*: the routes a member of staff's phone may use (Phase 9, T3).
 * Everything else under /api is owner-only (see requireRoundsApi). A caller passes only if ALL of these hold:
 *  - a valid bearer token,
 *  - a `workers` row for this login that is not the owner's own row (platform_solo) and not deactivated,
 *  - a team_people row (kind lead) pointing at it that has not ended,
 *  - the business has an entitled Rounds plan and no Pro tier.
 * The business, the worker and the person all come from the token, never from the request. Any read problem is a
 * refusal (fail safe). `db` is the service-role client: every query written with it must filter by tenantId and workerId.
 */

export type StaffApiContext = {
  userId: string;
  tenantId: string;
  workerId: string;
  personId: string;
  name: string;
  db: SupabaseClient;
};

function respond(status: 401 | 403, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const NOT_STAFF = 'not_staff';
export const PLAN_ENDED = 'plan_ended';

/**
 * The shared "is this login a live lead?" check, for the phone's bearer token (requireStaffApi) and the website's session
 * (getStaffSession). Takes a user id that came from a verified token or session, never from a request body or URL.
 */
export async function resolveStaffContext(
  db: SupabaseClient,
  userId: string,
): Promise<{ ok: true; ctx: StaffApiContext } | { ok: false; reason: typeof NOT_STAFF | typeof PLAN_ENDED }> {
  try {
    const { data: workerRows, error: workerError } = await db
      .from('workers')
      .select('id, worker_type, primary_tenant_id, invite_status, updated_at')
      .eq('user_id', userId);
    if (workerError || !Array.isArray(workerRows)) return { ok: false, reason: NOT_STAFF };
    const worker = pickWorkerRow(workerRows as WorkerRowLite[]);
    if (!worker?.primary_tenant_id) return { ok: false, reason: NOT_STAFF };
    const tenantId = worker.primary_tenant_id;

    const { data: person, error: personError } = await db
      .from('team_people')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('worker_id', worker.id)
      .eq('kind', 'lead')
      .is('ended_at', null)
      .maybeSingle();
    if (personError || !person) return { ok: false, reason: NOT_STAFF };

    const { data: subs, error: subsError } = await db
      .from('subscriptions')
      .select('product, status')
      .eq('tenant_id', tenantId)
      .in('status', [...ENTITLED_STATUSES]);
    if (subsError || !Array.isArray(subs)) return { ok: false, reason: NOT_STAFF };
    const rows = subs as Array<{ product: string | null; status: string | null }>;
    if (hasProTier(rows)) return { ok: false, reason: NOT_STAFF };
    if (!rows.some((r) => r.product === 'rounds')) return { ok: false, reason: PLAN_ENDED };

    const p = person as { id: string; name: string };
    return { ok: true, ctx: { userId, tenantId, workerId: worker.id, personId: p.id, name: p.name, db } };
  } catch (err) {
    console.error('[staff] guard', err instanceof Error ? err.name : 'error');
    return { ok: false, reason: NOT_STAFF };
  }
}

export async function requireStaffApi(
  request: Request,
): Promise<{ ok: true; ctx: StaffApiContext } | { ok: false; response: NextResponse }> {
  const auth = await createClientFromBearer(request);
  if (!auth) return { ok: false, response: respond(401, 'Unauthorised') };
  const result = await resolveStaffContext(createAdminClient(), auth.userId);
  if (!result.ok) return { ok: false, response: respond(403, result.reason) };
  return { ok: true, ctx: result.ctx };
}

export function staffJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const NOT_YOURS = 'not_yours';

/** The visit must be assigned to this member of staff (and be in their business). */
export async function ownsVisit(ctx: StaffApiContext, jobId: string): Promise<boolean> {
  const { data, error } = await ctx.db
    .from('jobs')
    .select('id, assigned_worker_id')
    .eq('id', jobId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { assigned_worker_id: string | null }).assigned_worker_id === ctx.workerId;
}
