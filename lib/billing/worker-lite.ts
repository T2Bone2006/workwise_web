import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import { isBillingInterval, priceIdFor, type BillingInterval } from '@/lib/billing/plans';
import { decideGate, hasLiveLite, hasProTier, isLinkLive, type WorkerLiteGateReason } from '@/lib/billing/worker-gate';

/**
 * Lite for a self-employed worker, at the worker price (20% off while they work with a Pro business).
 * All reads use the service role: the buyer's own session cannot see their employer's subscriptions,
 * and the answer decides what they are charged, so it must not depend on what they can read.
 */

export type WorkerLiteGate =
  | { ok: true; workerId: string; employerTenantId: string; employerName: string }
  | { ok: false; reason: WorkerLiteGateReason };

const UNKNOWN: WorkerLiteGate = { ok: false, reason: 'unknown' };

export type LinkState = {
  /** true / false, or 'unknown' when a read failed (callers must then change nothing). */
  link: boolean | 'unknown';
  workerFound: boolean;
  employerTenantId: string | null;
  employerName: string | null;
};

/** Is the worker (by id) still connected to an employer with a live Pro plan? Service-role reads. */
export async function readLinkState(
  admin: ReturnType<typeof createAdminClient>,
  linkedWorkerId: string,
): Promise<LinkState> {
  const { data: worker, error: workerError } = await admin
    .from('workers')
    .select('id, invite_status, worker_type, primary_tenant_id')
    .eq('id', linkedWorkerId)
    .maybeSingle<{ id: string; invite_status: string | null; worker_type: string | null; primary_tenant_id: string | null }>();
  if (workerError) return { link: 'unknown', workerFound: false, employerTenantId: null, employerName: null };

  let employerHasPro: boolean | null = null;
  let employerName: string | null = null;
  if (worker?.primary_tenant_id) {
    const [{ data: employerRows, error: employerError }, { data: employer }] = await Promise.all([
      admin.from('subscriptions').select('product, status').eq('tenant_id', worker.primary_tenant_id),
      admin.from('tenants').select('name').eq('id', worker.primary_tenant_id).maybeSingle<{ name: string | null }>(),
    ]);
    employerHasPro = employerError ? null : hasProTier(employerRows ?? []);
    employerName = employer?.name?.trim() || null;
  } else {
    employerHasPro = false; // the worker row is gone, or has no employer: the link has ended
  }

  return {
    link: isLinkLive({
      workerFound: Boolean(worker),
      inviteStatus: worker?.invite_status ?? null,
      workerType: worker?.worker_type ?? null,
      employerHasProTier: employerHasPro,
    }),
    workerFound: Boolean(worker),
    employerTenantId: worker?.primary_tenant_id ?? null,
    employerName,
  };
}

export async function checkWorkerLiteGate(tenantId: string): Promise<WorkerLiteGate> {
  try {
    const admin = createAdminClient();
    const { data: tenant, error: tenantError } = await admin
      .from('tenants')
      .select('closed_at, worker_discount_worker_id')
      .eq('id', tenantId)
      .maybeSingle<{ closed_at: string | null; worker_discount_worker_id: string | null }>();
    if (tenantError || !tenant) return UNKNOWN;

    const linkedWorkerId = tenant.worker_discount_worker_id;
    if (tenant.closed_at || !linkedWorkerId) {
      return decideGate({ closedAt: tenant.closed_at, linkedWorkerId, link: false, alreadyHasLite: false }) as WorkerLiteGate;
    }

    const [state, { data: ownRows, error: ownError }] = await Promise.all([
      readLinkState(admin, linkedWorkerId),
      admin.from('subscriptions').select('product, status').eq('tenant_id', tenantId),
    ]);
    if (ownError) return UNKNOWN;

    const decision = decideGate({
      closedAt: null,
      linkedWorkerId,
      link: state.link,
      alreadyHasLite: hasLiveLite(ownRows ?? []),
    });
    if (!decision.ok) return decision;
    return {
      ok: true,
      workerId: linkedWorkerId,
      employerTenantId: state.employerTenantId as string,
      employerName: state.employerName ?? 'your employer',
    };
  } catch (err) {
    console.error('[worker-lite] gate', err instanceof Error ? err.name : 'Error');
    return UNKNOWN;
  }
}

/** True when this business was made from a worker invite. A read failure says false: it only guards Rounds. */
export async function isWorkerBusiness(tenantId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('tenants')
      .select('worker_discount_worker_id')
      .eq('id', tenantId)
      .maybeSingle<{ worker_discount_worker_id: string | null }>();
    if (error) return false;
    return Boolean(data?.worker_discount_worker_id);
  } catch {
    return false;
  }
}

/** The Stripe customer for the business, made on first need and stored once even if two requests race. */
async function ensureCustomerId(tenantId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: tenant, error } = await admin
    .from('tenants')
    .select('name, stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle<{ name: string; stripe_customer_id: string | null }>();
  if (error || !tenant) throw new Error('read_failed');
  if (tenant.stripe_customer_id) return tenant.stripe_customer_id;

  const { data: adminUser } = await admin
    .from('users')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle<{ email: string | null }>();

  const customer = await getStripe().customers.create(
    { email: adminUser?.email ?? undefined, name: tenant.name, metadata: { tenant_id: tenantId } },
    { idempotencyKey: `worker-lite-customer-${tenantId}` },
  );

  const { data: stored, error: storeError } = await admin
    .from('tenants')
    .update({ stripe_customer_id: customer.id })
    .eq('id', tenantId)
    .is('stripe_customer_id', null)
    .select('id');
  if (storeError) throw new Error('store_failed');
  if (Array.isArray(stored) && stored.length > 0) return customer.id;

  // Someone else stored one first: use theirs.
  const { data: again } = await admin
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle<{ stripe_customer_id: string | null }>();
  if (!again?.stripe_customer_id) throw new Error('store_failed');
  return again.stripe_customer_id;
}

/**
 * Opens Stripe Checkout for Lite at the worker price. The price and coupon come from the server only.
 * Throws Error('gate:<reason>'), 'missing_coupon', 'bad_interval', 'bad_nonce', 'no_url' or a read error.
 */
export async function createWorkerLiteCheckout(tenantId: string, interval: BillingInterval, nonce: string): Promise<string> {
  if (!isBillingInterval(interval)) throw new Error('bad_interval');
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(nonce)) throw new Error('bad_nonce');

  const coupon = process.env.STRIPE_COUPON_WORKER_LITE;
  if (!coupon) throw new Error('missing_coupon'); // never fall back to full price silently

  const gate = await checkWorkerLiteGate(tenantId);
  if (!gate.ok) throw new Error(`gate:${gate.reason}`);

  const customerId = await ensureCustomerId(tenantId);
  const appUrl = getAppUrl();
  const session = await getStripe().checkout.sessions.create(
    {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceIdFor({ plan: 'lite', interval }), quantity: 1 }],
      discounts: [{ coupon }],
      metadata: { kind: 'worker_lite', tenant_id: tenantId },
      subscription_data: {
        metadata: { kind: 'worker_lite', tenant_id: tenantId, plan: 'lite', interval },
      },
      success_url: `${appUrl}/worker/lite-added`,
      cancel_url: `${appUrl}/add-lite`,
    },
    { idempotencyKey: `worker-lite-${tenantId}-${nonce}` },
  );
  if (!session.url) throw new Error('no_url');
  return session.url;
}
