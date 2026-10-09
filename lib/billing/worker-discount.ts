import 'server-only';

import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { decideDiscountAction } from '@/lib/billing/worker-gate';
import { readLinkState } from '@/lib/billing/worker-lite';
import { sendWorkerPriceEndedEmail } from '@/lib/emails/worker-price-ended';

/**
 * Keeps the worker price honest. A worker-made business pays 20% less for Lite only while the worker is
 * still connected to an employer with a live Pro plan. Run daily, and straight after an employer
 * deactivates, deletes or revokes a worker.
 *
 * Rules that matter, because this changes what people are charged:
 * - If we cannot tell whether the link is live, change nothing (the next run tries again).
 * - Taking the discount off is claimed first with a conditional update, so two runs at once do it once
 *   and send one email. A Stripe failure puts the claim back so tomorrow retries.
 * - Only the worker coupon is ever touched. Founding and referral discounts are left alone.
 */

export type ReconcileResult = { checked: number; removed: number; applied: number; skipped: number; errors: number };

type TenantRow = {
  id: string;
  name: string;
  worker_discount_worker_id: string;
  worker_discount_ended_notified_at: string | null;
};

type Outcome = 'removed' | 'applied' | 'skipped' | 'none' | 'error';

function couponIdOf(discount: Stripe.Discount): string | null {
  const coupon = discount.source?.coupon;
  if (!coupon) return null;
  return typeof coupon === 'string' ? coupon : coupon.id;
}

function discountEntries(subscription: Stripe.Subscription): Stripe.Discount[] {
  return (subscription.discounts ?? []).filter((d): d is Stripe.Discount => typeof d !== 'string');
}

/** A discount that has already ended does not count as one being on. An unexpanded id counts (fail closed). */
function anyDiscountOn(subscription: Stripe.Subscription): boolean {
  const now = Date.now() / 1000;
  return (subscription.discounts ?? []).some((entry) => typeof entry === 'string' || entry.end == null || entry.end > now);
}

async function reconcileTenant(admin: ReturnType<typeof createAdminClient>, tenant: TenantRow): Promise<Outcome> {
  const workerCoupon = process.env.STRIPE_COUPON_WORKER_LITE;
  if (!workerCoupon) return 'skipped';

  const { data: subs, error: subsError } = await admin
    .from('subscriptions')
    .select('stripe_subscription_id, product, status, source')
    .eq('tenant_id', tenant.id)
    .eq('product', 'lite');
  if (subsError) return 'skipped';
  const entitled = new Set<string>(ENTITLED_STATUSES);
  const lite = (subs ?? []).find(
    (row: { stripe_subscription_id: string | null; status: string | null; source: string | null }) =>
      row.source === 'stripe' && row.stripe_subscription_id && row.status && entitled.has(row.status),
  ) as { stripe_subscription_id: string } | undefined;
  if (!lite) return 'none'; // no Lite on Stripe to adjust

  const state = await readLinkState(admin, tenant.worker_discount_worker_id);
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(lite.stripe_subscription_id, { expand: ['discounts'] });

  const entries = discountEntries(subscription);
  const hasWorkerCoupon = entries.some((d) => couponIdOf(d) === workerCoupon);
  const action = decideDiscountAction({
    link: state.link,
    hasWorkerCoupon,
    hasAnyDiscount: anyDiscountOn(subscription),
    endedBefore: tenant.worker_discount_ended_notified_at != null,
  });

  if (action === 'leave') return 'none';
  if (action === 'blocked') {
    console.error('[worker-discount] link is back but another discount is on; leaving it for a person');
    return 'skipped';
  }

  if (action === 'reapply') {
    await stripe.subscriptions.update(lite.stripe_subscription_id, { discounts: [{ coupon: workerCoupon }] });
    const { error } = await admin
      .from('tenants')
      .update({ worker_discount_ended_notified_at: null })
      .eq('id', tenant.id);
    if (error) console.error('[worker-discount] could not clear the ended marker');
    return 'applied';
  }

  // action === 'remove': claim first, so only one run takes it off and sends the email.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('tenants')
    .update({ worker_discount_ended_notified_at: claimedAt })
    .eq('id', tenant.id)
    .is('worker_discount_ended_notified_at', null)
    .select('id');
  if (claimError) return 'skipped';
  if (!Array.isArray(claimed) || claimed.length === 0) return 'skipped'; // another run has it

  try {
    const kept = entries.filter((d) => couponIdOf(d) !== workerCoupon).map((d) => ({ discount: d.id }));
    await stripe.subscriptions.update(lite.stripe_subscription_id, { discounts: kept.length > 0 ? kept : '' });
  } catch (err) {
    // Put the claim back so the next run tries again. If even that fails, say so loudly: this tenant would be stuck.
    const { error: revertError } = await admin
      .from('tenants')
      .update({ worker_discount_ended_notified_at: null })
      .eq('id', tenant.id)
      .eq('worker_discount_ended_notified_at', claimedAt);
    if (revertError) console.error('[worker-discount] could not put the claim back; a person must clear it');
    console.error('[worker-discount] removing the discount failed', err instanceof Error ? err.name : 'Error');
    return 'error';
  }

  // The discount is off. Telling them is best effort and never undoes it.
  const { data: owner } = await admin
    .from('users')
    .select('email')
    .eq('tenant_id', tenant.id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle<{ email: string | null }>();
  if (owner?.email) {
    await sendWorkerPriceEndedEmail({ to: owner.email, businessName: tenant.name, employerName: state.employerName });
  } else {
    console.error('[worker-discount] no admin address to tell');
  }
  return 'removed';
}

export async function reconcileWorkerDiscounts(opts: { workerId?: string } = {}): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, removed: 0, applied: 0, skipped: 0, errors: 0 };
  const admin = createAdminClient();

  let query = admin
    .from('tenants')
    .select('id, name, worker_discount_worker_id, worker_discount_ended_notified_at')
    .not('worker_discount_worker_id', 'is', null)
    .is('closed_at', null);
  if (opts.workerId) query = query.eq('worker_discount_worker_id', opts.workerId);

  const { data, error } = await query;
  if (error) throw new Error('[worker-discount] could not list businesses');

  for (const tenant of (data ?? []) as TenantRow[]) {
    result.checked += 1;
    try {
      const outcome = await reconcileTenant(admin, tenant);
      if (outcome === 'removed') result.removed += 1;
      else if (outcome === 'applied') result.applied += 1;
      else if (outcome === 'skipped') result.skipped += 1;
      else if (outcome === 'error') result.errors += 1;
    } catch (err) {
      result.errors += 1;
      console.error('[worker-discount] tenant failed', err instanceof Error ? err.name : 'Error');
    }
  }
  return result;
}

/** For the employer's actions. Never throws and never slows or fails the action that called it. */
export async function reconcileForWorker(workerId: string): Promise<void> {
  try {
    await reconcileWorkerDiscounts({ workerId });
  } catch (err) {
    console.error('[worker-discount] reconcile after worker change failed', err instanceof Error ? err.name : 'Error');
  }
}
