import 'server-only';

import { getStripe } from '@/lib/stripe/client';
import { productsForPriceId } from '@/lib/billing/plans';
import { PRO_ALLOWANCES, PRO_TIER_ORDER, type ProTier } from '@/lib/billing/pro-allowance';
import { PRO_PLANS, classifyProChange } from '@/lib/billing/pro-plans';
import { isExtraWorkerPrice, proChoiceForPriceId } from '@/lib/billing/pro-plan-prices';
import { proBreakdown, splitProItems, type ProLine } from '@/lib/billing/pro-plan-core';
import {
  cardFrom,
  currentUserIsAdminOf,
  customerBitsOf,
  discountSummary,
  invoicesOf,
  iso,
  logStripe,
  nextBillOf,
  periodEndUnix,
  type CardSummary,
  type InvoiceRow,
} from '@/lib/billing/manage';
import { loadProSubscription, loadWorkerAllowance } from '@/lib/data/worker-allowance';

export type ProPlanSummary =
  | { kind: 'managed' }
  | { kind: 'unavailable' }
  | {
      kind: 'pro';
      subscriptionId: string;
      tier: ProTier;
      tierName: string;
      status: 'active' | 'past_due' | 'trialing' | 'incomplete';
      /** Billed monthly or yearly: from the plan line's price, else our row, else monthly. */
      interval: 'month' | 'year';
      /** Tiers this business could upgrade to right now (same interval, higher tier). [] when a cancellation is pending, the payment is overdue, a change is waiting, or the plan has a custom included-workers number. */
      canUpgradeTo: ProTier[];
      /** Why upgrading isn't offered right now, or null when it is (or there is nothing above this tier). */
      upgradeBlockedReason: 'ending' | 'overdue' | 'waiting' | 'custom' | null;
      /** A monthly plan that can switch to yearly itself right now (not while cancelling, overdue, waiting, or with a discount/booked change). */
      canSwitchToYearly: boolean;
      currentPeriodEnd: string;
      trialEndsAt: string | null;
      cancelAtPeriodEnd: boolean;
      /** Workers on the team now, the plan's allowance, and how many are over it. */
      used: number;
      included: number;
      over: number;
      /** What each line of the subscription costs per month, and the total. */
      lines: ProLine[];
      monthlyPence: number;
      nextBill: { date: string; amountPence: number } | null;
      discount: { label: string; endsAt: string | null } | null;
      creditPence: number;
      card: CardSummary | null;
      invoices: InvoiceRow[];
    };

const LIVE = new Set(['active', 'past_due', 'trialing', 'incomplete']);

function tierOfPrice(priceId: string): ProTier | null {
  const product = productsForPriceId(priceId).find((p) => (PRO_TIER_ORDER as readonly string[]).includes(p));
  return (product as ProTier | undefined) ?? null;
}

/**
 * What a Stripe-billed Pro business pays and why: its plan line, any extra-worker line, the next bill,
 * card and invoices. Manual Pro accounts (RS Locksmiths, Eden) and anyone who isn't the account owner
 * get { kind: 'managed' } and keep the managed tab. Never throws.
 */
export async function getProPlanSummary(tenantId: string): Promise<ProPlanSummary> {
  try {
    if (!(await currentUserIsAdminOf(tenantId))) return { kind: 'managed' };

    const row = await loadProSubscription(tenantId);
    if (!row || row.source === 'manual' || !row.stripe_subscription_id) return { kind: 'managed' };

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id, {
      expand: ['default_payment_method', 'discounts'],
    });
    if (!LIVE.has(subscription.status)) return { kind: 'unavailable' };

    const { plan, tier, extra } = splitProItems(
      subscription.items.data.map((i) => ({
        id: i.id,
        priceId: i.price.id,
        quantity: i.quantity ?? 0,
        unitPence: i.price.unit_amount,
      })),
      tierOfPrice,
      isExtraWorkerPrice
    );
    if (!plan || !tier) return { kind: 'unavailable' };

    const base = PRO_ALLOWANCES[tier];
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    const [allowance, discount, customerBits, nextBill, invoices] = await Promise.all([
      loadWorkerAllowance(tenantId),
      discountSummary(subscription),
      customerBitsOf(customerId),
      nextBillOf({ subscription, customerId }),
      invoicesOf(customerId),
    ]);
    const card = (await cardFrom(subscription.default_payment_method)) ?? customerBits.card;

    const breakdown = proBreakdown({
      tierName: base.name,
      planUnitPence: plan.unitPence ?? 0,
      extraQuantity: extra?.quantity ?? 0,
      extraUnitPence: extra?.unitPence ?? PRO_PLANS[tier].extraPence[proChoiceForPriceId(plan.priceId)?.interval ?? 'month'],
    });

    const periodEnd = periodEndUnix(subscription);
    const interval = proChoiceForPriceId(plan.priceId)?.interval ?? (row.billing_interval === 'year' ? 'year' : 'month');
    const upgradeBlockedReason: 'ending' | 'overdue' | 'waiting' | 'custom' | null = subscription.cancel_at_period_end
      ? 'ending'
      : subscription.status === 'past_due'
        ? 'overdue'
        : subscription.pending_update
          ? 'waiting'
          : row.included_workers_override != null
            ? 'custom'
            : null;
    return {
      kind: 'pro',
      subscriptionId: subscription.id,
      tier,
      tierName: base.name,
      status: subscription.status as 'active' | 'past_due' | 'trialing' | 'incomplete',
      interval,
      canUpgradeTo: upgradeBlockedReason
        ? []
        : PRO_TIER_ORDER.filter((t) => classifyProChange({ tier, interval }, { tier: t, interval }) === 'up_now'),
      upgradeBlockedReason,
      canSwitchToYearly:
        interval === 'month' &&
        (upgradeBlockedReason === null || upgradeBlockedReason === 'custom') &&
        (subscription.discounts ?? []).length === 0 &&
        !subscription.schedule,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : '',
      trialEndsAt: iso(subscription.trial_end),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      used: allowance?.used ?? 0,
      included: allowance?.included ?? base.included,
      over: allowance?.over ?? 0,
      lines: breakdown.lines,
      monthlyPence: breakdown.monthlyPence,
      nextBill,
      discount,
      creditPence: customerBits.creditPence,
      card,
      invoices,
    };
  } catch (err) {
    logStripe('getProPlanSummary', err);
    return { kind: 'unavailable' };
  }
}
