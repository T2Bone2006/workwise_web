import 'server-only';

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe/client';
import { syncSubscription } from '@/lib/stripe/sync-subscription';
import { countTeamWorkers } from '@/lib/data/workers';
import { allowanceFor, loadProSubscription, type ProSubscriptionRow } from '@/lib/data/worker-allowance';
import type { Allowance } from '@/lib/billing/pro-allowance';
import { PRO_PLANS, PRO_TIER_ORDER, classifyProChange, proPriceLabel, type ProChoice, type ProTier } from '@/lib/billing/pro-plans';
import { extraWorkerPriceIdFor, isExtraWorkerPrice, proChoiceForPriceId, proPlanPriceId } from '@/lib/billing/pro-plan-prices';
import { buildUpgradeItems, buildYearlyItems, overAfterUpgrade, yearlySwitchFigures, type UpgradeItem } from '@/lib/billing/pro-manage-core';
import { reconcileExtraWorkers } from '@/lib/billing/extra-workers';
import { hostedUrl, logStripe, periodEndUnix } from '@/lib/billing/manage';

/** Cancel, undo and upgrade for a Stripe-billed Pro business. Callers have already checked the user is the tenant's admin. */

export type ProUpgradePreview =
  | {
      ok: true;
      target: ProTier;
      interval: 'month' | 'year';
      /** What is taken from the card today (pence), from Stripe's own preview. */
      todayPence: number;
      /** What the plan costs from the next renewal, e.g. '£449 a month'. */
      thenLabel: string;
      renewsOn: string;
      /** Workers over the new allowance after the upgrade (0 = the extra line goes away). */
      overAfter: number;
      includedAfter: number;
    }
  | { ok: false; error: string };

export type ProYearlyPreview =
  | {
      ok: true;
      tier: ProTier;
      /** What is taken from the card today (pence), from Stripe's own preview. */
      todayPence: number;
      /** The unused part of this month's payment that comes off today's charge (pence). */
      creditPence: number;
      /** What each yearly bill costs for this team (plan + extras), and what 12 monthly bills would have cost. */
      yearlyPence: number;
      monthlyPence: number;
      yearOfMonthsPence: number;
      savesPence: number;
      extras: number;
      /** The new year starts today and the next yearly bill is on this date. */
      startsOn: string;
      renewsOn: string;
    }
  | { ok: false; error: string };

export type ProChangeResult =
  | { ok: true; applied: 'now' }
  | { ok: true; needsAction: { hostedInvoiceUrl: string } }
  | { ok: false; error: string; preview?: ProUpgradePreview };

const MANAGED = 'Your plan is managed by WorkWise. Contact us to make changes.';
const NOT_OFFERED = 'That change isn’t available here. Contact us and we’ll sort it.';
const CUSTOM = 'Your plan has a custom set-up, so contact us to change it.';
const UNDO_FIRST = 'Undo your cancellation first.';
const UPDATE_CARD = 'Update your card first, then you can change your plan.';
const WAITING = 'Your last change is still waiting for your bank to confirm the payment.';
const AMOUNT_CHANGED = 'The amount has changed. Please check it and confirm again.';
const CHANGE_ERROR = "Couldn't change your plan. Nothing was charged. Please try again.";

const LIVE = new Set(['active', 'trialing', 'past_due']);

type Context = {
  row: ProSubscriptionRow;
  subscription: Stripe.Subscription;
  customerId: string;
  planItem: Stripe.SubscriptionItem;
  extraItem: Stripe.SubscriptionItem | null;
  choice: ProChoice;
  periodEnd: number | null;
};

async function loadContext(
  tenantId: string,
  client?: SupabaseClient,
): Promise<{ ok: true; ctx: Context } | { ok: false; error: string }> {
  const row = await loadProSubscription(tenantId, client);
  if (!row || row.source === 'manual' || !row.stripe_subscription_id) return { ok: false, error: MANAGED };
  const subscription = await getStripe().subscriptions.retrieve(row.stripe_subscription_id);
  if (!LIVE.has(subscription.status)) return { ok: false, error: NOT_OFFERED };
  const planItem = subscription.items.data.find((i) => proChoiceForPriceId(i.price.id));
  const choice = planItem ? proChoiceForPriceId(planItem.price.id) : null;
  if (!planItem || !choice) return { ok: false, error: NOT_OFFERED };
  const extraItem = subscription.items.data.find((i) => isExtraWorkerPrice(i.price.id)) ?? null;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  return {
    ok: true,
    ctx: { row, subscription, customerId, planItem, extraItem, choice, periodEnd: periodEndUnix(subscription) },
  };
}

type UpgradePlan = {
  items: UpgradeItem[];
  target: ProChoice;
  overAfter: number;
  includedAfter: number;
};

/** The refusals that apply to any change, then the items for this upgrade. Nothing is written. */
async function planUpgrade(
  tenantId: string,
  ctx: Context,
  target: ProTier,
  client?: SupabaseClient,
): Promise<{ ok: true; plan: UpgradePlan; allowance: Allowance } | { ok: false; error: string }> {
  if (ctx.row.included_workers_override != null) return { ok: false, error: CUSTOM };
  if (ctx.subscription.cancel_at_period_end) return { ok: false, error: UNDO_FIRST };
  if (ctx.subscription.status === 'past_due') return { ok: false, error: UPDATE_CARD };
  if (ctx.subscription.pending_update) return { ok: false, error: WAITING };

  const targetChoice: ProChoice = { tier: target, interval: ctx.choice.interval };
  if (classifyProChange(ctx.choice, targetChoice) !== 'up_now') return { ok: false, error: NOT_OFFERED };

  const team = await countTeamWorkers(tenantId, { includePending: true }, client);
  if (team === null) return { ok: false, error: CHANGE_ERROR };
  const allowance = allowanceFor(ctx.row, team);
  const includedAfter = PRO_PLANS[target].included;
  const overAfter = overAfterUpgrade(team, includedAfter);
  const extraPrice = overAfter > 0 ? extraWorkerPriceIdFor(target, ctx.choice.interval) : null;
  if (overAfter > 0 && !extraPrice) return { ok: false, error: CHANGE_ERROR };

  const items = buildUpgradeItems({
    planItemId: ctx.planItem.id,
    extraItemId: ctx.extraItem?.id ?? null,
    targetPlanPriceId: proPlanPriceId(targetChoice),
    targetExtraPriceId: extraPrice,
    newOver: overAfter,
  });
  return { ok: true, plan: { items, target: targetChoice, overAfter, includedAfter }, allowance };
}

async function previewFrom(tenantId: string, ctx: Context, target: ProTier, client?: SupabaseClient): Promise<ProUpgradePreview> {
  const planned = await planUpgrade(tenantId, ctx, target, client);
  if (!planned.ok) return planned;
  const preview = await getStripe().invoices.createPreview({
    customer: ctx.customerId,
    subscription: ctx.subscription.id,
    subscription_details: { items: planned.plan.items, proration_behavior: 'always_invoice' },
  });
  return {
    ok: true,
    target,
    interval: ctx.choice.interval,
    todayPence: preview.amount_due,
    thenLabel: proPriceLabel(planned.plan.target),
    renewsOn: new Date((ctx.periodEnd ?? 0) * 1000).toISOString(),
    overAfter: planned.plan.overAfter,
    includedAfter: planned.plan.includedAfter,
  };
}

type YearlyPlan = { items: UpgradeItem[]; extras: number };

/** The refusals that apply to switching to yearly, then the items. Nothing is written. */
function planYearly(ctx: Context): { ok: true; plan: YearlyPlan } | { ok: false; error: string } {
  if (ctx.choice.interval !== 'month') return { ok: false, error: NOT_OFFERED };
  if (ctx.subscription.cancel_at_period_end) return { ok: false, error: UNDO_FIRST };
  if (ctx.subscription.status === 'past_due') return { ok: false, error: UPDATE_CARD };
  if (ctx.subscription.pending_update) return { ok: false, error: WAITING };
  // A discount or a booked change would be carried into a whole year; those are handled by us.
  if ((ctx.subscription.discounts ?? []).length > 0 || ctx.subscription.schedule) return { ok: false, error: NOT_OFFERED };

  const tier = ctx.choice.tier;
  const extras = ctx.extraItem?.quantity ?? 0;
  const yearlyExtraPriceId = extras > 0 ? extraWorkerPriceIdFor(tier, 'year') : null;
  if (extras > 0 && !yearlyExtraPriceId) return { ok: false, error: CHANGE_ERROR };
  return {
    ok: true,
    plan: {
      extras,
      items: buildYearlyItems({
        planItemId: ctx.planItem.id,
        yearlyPlanPriceId: proPlanPriceId({ tier, interval: 'year' }),
        extraItemId: ctx.extraItem?.id ?? null,
        extraQuantity: extras,
        yearlyExtraPriceId,
      }),
    },
  };
}

/** The year starts today (billing_cycle_anchor: 'now'): Stripe credits the unused part of this month and bills the full year. */
async function previewYearlyFrom(ctx: Context): Promise<ProYearlyPreview> {
  const planned = planYearly(ctx);
  if (!planned.ok) return planned;
  const preview = await getStripe().invoices.createPreview({
    customer: ctx.customerId,
    subscription: ctx.subscription.id,
    subscription_details: {
      items: planned.plan.items,
      billing_cycle_anchor: 'now',
      proration_behavior: 'always_invoice',
    },
  });
  const lines = preview.lines?.data ?? [];
  const creditPence = lines.reduce((sum, line) => ((line.amount ?? 0) < 0 ? sum - (line.amount ?? 0) : sum), 0);
  const ends = lines.filter((line) => (line.amount ?? 0) > 0 && line.period?.end).map((line) => line.period.end);
  const renewsUnix = ends.length > 0 ? Math.max(...ends) : null;
  if (!renewsUnix) return { ok: false, error: CHANGE_ERROR };
  const tier = ctx.choice.tier;
  const figures = yearlySwitchFigures({
    planMonthlyPence: PRO_PLANS[tier].pence.month,
    extraMonthlyPence: PRO_PLANS[tier].extraPence.month,
    planYearlyPence: PRO_PLANS[tier].pence.year,
    extraYearlyPence: PRO_PLANS[tier].extraPence.year,
    extras: planned.plan.extras,
  });
  return {
    ok: true,
    tier,
    todayPence: preview.amount_due,
    creditPence,
    ...figures,
    extras: planned.plan.extras,
    startsOn: new Date().toISOString(),
    renewsOn: new Date(renewsUnix * 1000).toISOString(),
  };
}

/** Read-only: what switching to yearly costs today and when the next yearly bill is. */
export async function previewProYearly(tenantId: string, client?: SupabaseClient): Promise<ProYearlyPreview> {
  try {
    const loaded = await loadContext(tenantId, client);
    if (!loaded.ok) return loaded;
    return await previewYearlyFrom(loaded.ctx);
  } catch (err) {
    logStripe('previewProYearly', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

/**
 * Switches a monthly Pro plan to yearly now: the year starts today, the unused part of this month is credited, and the
 * full yearly price (plan + extras for the team they have) is taken. `expectedTodayPence` is what the dialog showed.
 */
export async function switchProToYearly(
  tenantId: string,
  expectedTodayPence: number,
  nonce: string,
  client?: SupabaseClient,
): Promise<ProChangeResult> {
  try {
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(nonce) || !Number.isFinite(expectedTodayPence)) {
      return { ok: false, error: CHANGE_ERROR };
    }
    const loaded = await loadContext(tenantId, client);
    if (!loaded.ok) return loaded;
    const { ctx } = loaded;

    const preview = await previewYearlyFrom(ctx);
    if (!preview.ok) return { ok: false, error: preview.error };
    if (Math.abs(preview.todayPence - expectedTodayPence) > 1) return { ok: false, error: AMOUNT_CHANGED };

    const planned = planYearly(ctx);
    if (!planned.ok) return { ok: false, error: planned.error };

    const updated = await getStripe().subscriptions.update(
      ctx.subscription.id,
      {
        items: planned.plan.items,
        billing_cycle_anchor: 'now',
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice'],
      },
      { idempotencyKey: `pro-yearly-${tenantId}-${nonce}` },
    );

    if (updated.pending_update) {
      const url = await hostedUrl(updated.latest_invoice);
      return url ? { ok: true, needsAction: { hostedInvoiceUrl: url } } : { ok: false, error: CHANGE_ERROR };
    }

    // Our rows follow at once (the webhook does the same later, harmlessly), then the extra-worker safety net runs.
    let synced = false;
    try {
      synced = (await syncSubscription(updated)).synced;
    } catch (err) {
      logStripe('switchProToYearly.sync', err);
    }
    if (synced) await reconcileExtraWorkers(tenantId, client);
    return { ok: true, applied: 'now' };
  } catch (err) {
    logStripe('switchProToYearly', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

function isTier(value: unknown): value is ProTier {
  return typeof value === 'string' && (PRO_TIER_ORDER as readonly string[]).includes(value);
}

/** Read-only: what upgrading to `target` costs today and what it does to the extra workers. */
export async function previewProUpgrade(tenantId: string, target: ProTier, client?: SupabaseClient): Promise<ProUpgradePreview> {
  try {
    if (!isTier(target)) return { ok: false, error: NOT_OFFERED };
    const loaded = await loadContext(tenantId, client);
    if (!loaded.ok) return loaded;
    return await previewFrom(tenantId, loaded.ctx, target, client);
  } catch (err) {
    logStripe('previewProUpgrade', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

/**
 * Moves up a tier now, pro-rata. `expectedTodayPence` is what the confirm dialog showed (the server re-previews and
 * refuses if it moved); `nonce` is made when the dialog opens, so a double click can't charge twice.
 */
export async function upgradeProTier(
  tenantId: string,
  target: ProTier,
  expectedTodayPence: number,
  nonce: string,
  client?: SupabaseClient,
): Promise<ProChangeResult> {
  try {
    if (!isTier(target) || typeof nonce !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(nonce) || !Number.isFinite(expectedTodayPence)) {
      return { ok: false, error: CHANGE_ERROR };
    }
    const loaded = await loadContext(tenantId, client);
    if (!loaded.ok) return loaded;
    const { ctx } = loaded;

    const preview = await previewFrom(tenantId, ctx, target, client);
    if (!preview.ok) return { ok: false, error: preview.error };
    if (Math.abs(preview.todayPence - expectedTodayPence) > 1) {
      return { ok: false, error: AMOUNT_CHANGED, preview };
    }

    const planned = await planUpgrade(tenantId, ctx, target, client);
    if (!planned.ok) return { ok: false, error: planned.error };

    const updated = await getStripe().subscriptions.update(
      ctx.subscription.id,
      {
        items: planned.plan.items,
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice'],
      },
      { idempotencyKey: `pro-upgrade-${tenantId}-${nonce}` },
    );

    if (updated.pending_update) {
      const url = await hostedUrl(updated.latest_invoice);
      return url ? { ok: true, needsAction: { hostedInvoiceUrl: url } } : { ok: false, error: CHANGE_ERROR };
    }

    // Our rows follow at once (the webhook does the same later, harmlessly). Only when they have caught up is it safe
    // to run the extra-worker safety net: it reads our rows, and a row still saying the OLD tier would put the extra
    // line back to the old tier's price and size. If the sync didn't succeed, the webhook and the daily check do it.
    let synced = false;
    try {
      const result = await syncSubscription(updated);
      synced = result.synced;
    } catch (err) {
      logStripe('upgradeProTier.sync', err);
    }
    if (synced) await reconcileExtraWorkers(tenantId, client);
    return { ok: true, applied: 'now' };
  } catch (err) {
    logStripe('upgradeProTier', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

/** Keeps everything until the end of the period they have paid for. No refund. Idempotent. */
export async function cancelProPlan(
  tenantId: string,
  client?: SupabaseClient,
): Promise<{ ok: true; endsOn: string } | { ok: false; error: string }> {
  try {
    const loaded = await loadContext(tenantId, client);
    if (!loaded.ok) return loaded;
    const { ctx } = loaded;
    if (ctx.subscription.cancel_at_period_end) {
      return { ok: true, endsOn: new Date((ctx.periodEnd ?? 0) * 1000).toISOString() };
    }
    const updated = await getStripe().subscriptions.update(ctx.subscription.id, { cancel_at_period_end: true });
    const ends = periodEndUnix(updated) ?? ctx.periodEnd ?? 0;
    return { ok: true, endsOn: new Date(ends * 1000).toISOString() };
  } catch (err) {
    logStripe('cancelProPlan', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}

export async function undoProCancel(tenantId: string, client?: SupabaseClient): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const loaded = await loadContext(tenantId, client);
    if (!loaded.ok) return loaded;
    if (loaded.ctx.subscription.cancel_at_period_end) {
      await getStripe().subscriptions.update(loaded.ctx.subscription.id, { cancel_at_period_end: false });
    }
    return { ok: true };
  } catch (err) {
    logStripe('undoProCancel', err);
    return { ok: false, error: CHANGE_ERROR };
  }
}
