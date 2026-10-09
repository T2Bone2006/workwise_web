import 'server-only';

import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { countTeamWorkers } from '@/lib/data/workers';
import { allowanceFor, loadProSubscription } from '@/lib/data/worker-allowance';
import { PRO_TIER_ORDER, type ProTier } from '@/lib/billing/pro-allowance';
import {
  extrasToBill,
  paidForWorkers,
  planExtraWorkerChange,
  prorationFor,
  type ExtraWorkerLine,
} from '@/lib/billing/extra-workers-core';
import { extraWorkerPriceIdFor, isExtraWorkerPrice, proChoiceForPriceId } from '@/lib/billing/pro-plan-prices';

/**
 * Keeps the "extra worker" line on a Pro business's Stripe subscription equal to the number of workers over
 * the plan's allowance. Monthly: Stripe prorates the change onto the next invoice. Yearly: the part-year is
 * charged (or credited) at once, because everything renews on one date.
 *
 * Rules that matter, because this changes what people are charged:
 * - Only Stripe-billed Pro businesses are touched. Manual accounts (RS Locksmiths, Eden) never are.
 * - It only ever moves the extra-worker line. The plan line is never changed.
 * - If anything can't be read (no price configured, can't count, Stripe error) it changes nothing and the
 *   next run tries again. It never throws into the code that added the worker.
 * - It is convergent: it sets the line to the people over the allowance, or to the team size paid for at signup
 *   until that many people are actually on the team. Running it twice is harmless.
 */

const BILLABLE_STRIPE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** The monthly extra-worker price for a tier (kept for callers that only know monthly). */
export function extraWorkerPriceId(tier: ProTier): string | null {
  return extraWorkerPriceIdFor(tier, 'month');
}

/** True for any of the six extra-worker price ids (monthly or yearly, any tier). */
export function isExtraWorkerPriceId(priceId: string): boolean {
  return isExtraWorkerPrice(priceId);
}

export type ExtraWorkersResult =
  | { outcome: 'unchanged' | 'added' | 'updated' | 'removed'; over: number }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'error'; message: string };

export async function reconcileExtraWorkers(
  tenantId: string,
  client?: SupabaseClient
): Promise<ExtraWorkersResult> {
  try {
    const admin = client ?? createAdminClient();

    const row = await loadProSubscription(tenantId, admin);
    if (!row) return { outcome: 'skipped', reason: 'no Pro subscription' };
    if (row.source === 'manual' || !row.stripe_subscription_id) {
      return { outcome: 'skipped', reason: 'manual account' };
    }

    const used = await countTeamWorkers(tenantId, { includePending: true }, admin);
    if (used === null) return { outcome: 'skipped', reason: 'could not count workers' };
    const allowance = allowanceFor(row, used);

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    if (!BILLABLE_STRIPE_STATUSES.has(subscription.status)) {
      return { outcome: 'skipped', reason: `subscription is ${subscription.status}` };
    }

    // The plan line is the one whose price is a known Pro plan price; its interval decides the extra price.
    const planItem = subscription.items.data.find((i) => proChoiceForPriceId(i.price.id));
    const planChoice = planItem ? proChoiceForPriceId(planItem.price.id) : null;
    if (!planItem || !planChoice) return { outcome: 'skipped', reason: 'plan line not recognised' };
    const interval = planChoice.interval;

    const paidFor = paidForWorkers(subscription.metadata);
    const billed = extrasToBill({
      used: allowance.used,
      included: allowance.included,
      paidForWorkers: paidFor,
    });

    const wantedPriceId = extraWorkerPriceIdFor(allowance.tier, interval);
    if (billed.over > 0 && !wantedPriceId) {
      console.warn('[extra-workers] extra-worker price ids are not configured; changing nothing');
      return { outcome: 'skipped', reason: 'extra-worker prices not configured' };
    }

    const line = subscription.items.data.find((i) => isExtraWorkerPrice(i.price.id));
    const current: ExtraWorkerLine | null = line
      ? { itemId: line.id, priceId: line.price.id, quantity: line.quantity ?? 0 }
      : null;

    const action = planExtraWorkerChange({
      over: billed.over,
      // When nobody is over, there is nothing to add; this only matters for add/set.
      wantedPriceId: wantedPriceId ?? '',
      current,
    });
    const proration = prorationFor(interval);

    let outcome: ExtraWorkersResult;
    switch (action.kind) {
      case 'none':
        outcome = { outcome: 'unchanged', over: billed.over };
        break;
      case 'add':
        await stripe.subscriptionItems.create({
          subscription: subscription.id,
          price: action.priceId,
          quantity: action.quantity,
          proration_behavior: proration,
        });
        outcome = { outcome: 'added', over: billed.over };
        break;
      case 'set':
        await stripe.subscriptionItems.update(action.itemId, {
          price: action.priceId,
          quantity: action.quantity,
          proration_behavior: proration,
        });
        outcome = { outcome: 'updated', over: billed.over };
        break;
      case 'remove':
        await stripe.subscriptionItems.del(action.itemId, { proration_behavior: proration });
        outcome = { outcome: 'removed', over: 0 };
        break;
    }

    // The team has caught the size they paid for. Later changes, including a shrink, follow headcount.
    if (billed.releasePaidFor) {
      await stripe.subscriptions.update(subscription.id, { metadata: { expected_workers: '' } });
    }
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[extra-workers] ${tenantId}:`, message);
    return { outcome: 'error', message };
  }
}

/**
 * Called after a worker is added, removed, deactivated or brought back. Runs after the response is sent so
 * the page isn't kept waiting on Stripe; if that isn't possible here, runs it in line. Never throws.
 */
export function reconcileExtraWorkersAfterChange(tenantId: string | null | undefined): void {
  if (!tenantId) return;
  const run = async () => {
    await reconcileExtraWorkers(tenantId);
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Daily: every Stripe-billed Pro business, so anything the live calls missed is put right. */
export async function reconcileAllExtraWorkers(): Promise<{
  checked: number;
  changed: number;
  skipped: number;
  errors: number;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('subscriptions')
    .select('tenant_id')
    .eq('source', 'stripe')
    .in('product', [...PRO_TIER_ORDER])
    .in('status', [...ENTITLED_STATUSES])
    .not('stripe_subscription_id', 'is', null);
  if (error) throw new Error(`[extra-workers] list failed: ${error.message}`);

  const tenantIds = Array.from(new Set((data ?? []).map((r) => r.tenant_id as string)));
  const tally = { checked: 0, changed: 0, skipped: 0, errors: 0 };
  for (const tenantId of tenantIds) {
    tally.checked += 1;
    const result = await reconcileExtraWorkers(tenantId, admin);
    if (result.outcome === 'error') tally.errors += 1;
    else if (result.outcome === 'skipped') tally.skipped += 1;
    else if (result.outcome !== 'unchanged') tally.changed += 1;
  }
  return tally;
}
