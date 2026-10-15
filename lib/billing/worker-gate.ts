import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';

/**
 * Rules for the worker price that need no database. Server side only (it reads the entitlement
 * lists from tenant-products); the price itself is in worker-price.ts, which the browser may import.
 */

type SubscriptionRowLite = { product: string | null; status: string | null };

/** True when the business has an entitled Pro-tier subscription (starter, growth or pro). */
export function hasProTier(rows: readonly SubscriptionRowLite[]): boolean {
  const entitled = new Set<string>(ENTITLED_STATUSES);
  const pro = new Set<string>(PRO_TIER_PRODUCTS);
  return rows.some((row) => row.status != null && entitled.has(row.status) && row.product != null && pro.has(row.product));
}

/** True when the business has an entitled Lite subscription. */
export function hasLiveLite(rows: readonly SubscriptionRowLite[]): boolean {
  const entitled = new Set<string>(ENTITLED_STATUSES);
  return rows.some((row) => row.product === 'lite' && row.status != null && entitled.has(row.status));
}

/**
 * Is the worker's link to a live Pro business still real? 'unknown' when we could not tell
 * (a read failed): callers must then change nothing.
 */
export function isLinkLive(input: {
  workerFound: boolean;
  inviteStatus: string | null;
  workerType: string | null;
  employerHasProTier: boolean | null;
}): boolean | 'unknown' {
  if (input.employerHasProTier === null) return 'unknown';
  if (!input.workerFound) return false;
  if (input.workerType === 'platform_solo') return false;
  if (input.inviteStatus === 'deactivated') return false;
  return input.employerHasProTier;
}

export type WorkerLiteGateReason = 'not_worker_business' | 'link_ended' | 'has_lite' | 'closed' | 'unknown';

/** Pure decision for the Lite checkout; the server function feeds it what it read. */
export function decideGate(input: {
  closedAt: string | null;
  linkedWorkerId: string | null;
  link: boolean | 'unknown';
  alreadyHasLite: boolean;
}): { ok: true } | { ok: false; reason: WorkerLiteGateReason } {
  if (input.closedAt) return { ok: false, reason: 'closed' };
  if (!input.linkedWorkerId) return { ok: false, reason: 'not_worker_business' };
  if (input.link === 'unknown') return { ok: false, reason: 'unknown' };
  if (input.link === false) return { ok: false, reason: 'link_ended' };
  if (input.alreadyHasLite) return { ok: false, reason: 'has_lite' };
  return { ok: true };
}

export const GATE_MESSAGE: Record<WorkerLiteGateReason, string> = {
  not_worker_business: "Lite at the worker price isn't available on this account.",
  link_ended: "Lite at the worker price isn't available on this account.",
  has_lite: 'Lite is already on for this account.',
  closed: "Lite at the worker price isn't available on this account.",
  unknown: 'Something went wrong. Please try again.',
};

export type DiscountAction = 'remove' | 'reapply' | 'leave' | 'blocked';

/**
 * What the daily check does about one business's worker discount.
 * - remove: the link has ended and the worker coupon is still on.
 * - reapply: the link is back, the coupon was taken off earlier, and nothing else is on the subscription.
 * - blocked: the link is back but another discount is on, so a person decides.
 * - leave: nothing to do, or we cannot tell (never change a bill on a guess).
 */
export function decideDiscountAction(input: {
  link: boolean | 'unknown';
  hasWorkerCoupon: boolean;
  hasAnyDiscount: boolean;
  endedBefore: boolean;
}): DiscountAction {
  if (input.link === 'unknown') return 'leave';
  if (input.link === false) return input.hasWorkerCoupon ? 'remove' : 'leave';
  if (!input.hasWorkerCoupon && input.endedBefore) return input.hasAnyDiscount ? 'blocked' : 'reapply';
  return 'leave';
}
