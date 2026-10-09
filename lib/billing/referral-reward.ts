import { PLANS, type PlanKey } from '@/lib/billing/plans';
import { PRO_PLANS, type ProTier } from '@/lib/billing/pro-plans';

export type ReferralSide =
  | { family: 'rounds_lite'; plan: PlanKey }
  | { family: 'pro'; tier: ProTier; interval: 'month' | 'year' };

type ProSide = Extract<ReferralSide, { family: 'pro' }>;

/** Pure. What the customer paid for the plan on an invoice, after coupon discounts and before customer-balance credit. */
export function paidValuePence(invoice: {
  subtotal: number;
  total_discount_amounts?: Array<{ amount: number }> | null;
}): number {
  const off = (invoice.total_discount_amounts ?? []).reduce((sum, row) => sum + row.amount, 0);
  return invoice.subtotal - off;
}

/** One month's list price of this side's plan, in pence (as listed). */
export function monthlyListPence(side: ReferralSide): number {
  return side.family === 'pro' ? PRO_PLANS[side.tier].pence.month : PLANS[side.plan].pence.month;
}

/**
 * Both sides Rounds/Lite: one month of the REFERRER's own plan (Phase 7 D5, unchanged).
 * Either side Pro: the cheaper of the two sides' monthly list prices (D11). Always a positive integer.
 */
export function rewardPence(input: { referrer: ReferralSide; referred: ReferralSide }): number {
  const { referrer, referred } = input;
  if (referrer.family === 'rounds_lite' && referred.family === 'rounds_lite') return monthlyListPence(referrer);
  return Math.min(monthlyListPence(referrer), monthlyListPence(referred));
}

/** Full paid bills the referred business needs before the reward: Rounds/Lite 1, Pro monthly 3, Pro yearly 1. */
export function billsNeeded(referred: ReferralSide): number {
  if (referred.family === 'rounds_lite') return 1;
  return referred.interval === 'month' ? 3 : 1;
}

/**
 * Does this invoice count as a full bill of the referred Pro plan? Paid, from the first payment or a renewal (not a
 * mid-cycle change such as an extra worker), and paid at no less than the plan's list price for its interval.
 * Extras are not required to reach that price.
 */
export function isFullProBill(
  invoice: {
    status: string | null;
    billing_reason: string | null;
    subtotal: number;
    total_discount_amounts?: Array<{ amount: number }> | null;
  },
  referred: ProSide,
): boolean {
  if (invoice.status !== 'paid') return false;
  if (invoice.billing_reason !== 'subscription_create' && invoice.billing_reason !== 'subscription_cycle') return false;
  return paidValuePence(invoice) >= PRO_PLANS[referred.tier].pence[referred.interval];
}
