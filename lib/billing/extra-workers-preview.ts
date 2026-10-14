import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe/client';
import { countTeamWorkers } from '@/lib/data/workers';
import { allowanceFor, loadProSubscription } from '@/lib/data/worker-allowance';
import { PRO_PLANS } from '@/lib/billing/pro-plans';
import { extrasToBill, paidForWorkers } from '@/lib/billing/extra-workers-core';
import { extraWorkerPriceIdFor, isExtraWorkerPrice, proChoiceForPriceId } from '@/lib/billing/pro-plan-prices';

export { chargeNowFromPreviewLines, isProrationLine, stripeNowUnix } from '@/lib/billing/stripe-preview-lines';
export type { PreviewLine } from '@/lib/billing/stripe-preview-lines';
import { chargeNowFromPreviewLines, isProrationLine, stripeNowUnix, type PreviewLine } from '@/lib/billing/stripe-preview-lines';

export type ExtraWorkerPreview =
  | {
      ok: true;
      interval: 'month' | 'year';
      /** Workers over the allowance after the change. */
      extrasAfter: number;
      /** One extra worker's price for this interval, in pence (1200 or 12000 for Starter). */
      perWorkerPence: number;
      /** Yearly only: what is charged now, pro-rata, in pence (the proration lines of Stripe's preview). Monthly: null. */
      chargeNowPence: number | null;
      /** Yearly only: what the renewal will charge for these extras, in pence. Monthly: null. */
      renewalExtrasPence: number | null;
    }
  | { ok: false };

/**
 * What adding `workersToAdd` workers to this business's team would cost, from Stripe's own preview.
 * Read-only: nothing is created. Never throws: any error, a manual account, no Stripe subscription, or no
 * extra worker needed → { ok: false } (the dialog only appears for Stripe-billed Pro over the allowance).
 */
export async function previewExtraWorkerCharge(
  tenantId: string,
  workersToAdd: number,
  client?: SupabaseClient
): Promise<ExtraWorkerPreview> {
  try {
    if (!Number.isFinite(workersToAdd) || workersToAdd <= 0) return { ok: false };

    const row = await loadProSubscription(tenantId, client);
    if (!row || row.source === 'manual' || !row.stripe_subscription_id) return { ok: false };

    const used = await countTeamWorkers(tenantId, { includePending: true }, client);
    if (used === null) return { ok: false };
    const allowance = allowanceFor(row, used);
    const actualAfter = Math.max(0, used + Math.floor(workersToAdd) - allowance.included);
    if (!allowance.limited || actualAfter === 0) return { ok: false };

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const planItem = subscription.items.data.find((i) => proChoiceForPriceId(i.price.id));
    const planChoice = planItem ? proChoiceForPriceId(planItem.price.id) : null;
    if (!planItem || !planChoice) return { ok: false };

    // Extras paid for at sign-up are already on the bill, so only the ones beyond them are new.
    const extrasAfter = extrasToBill({
      used: used + Math.floor(workersToAdd),
      included: allowance.included,
      paidForWorkers: paidForWorkers(subscription.metadata),
    }).over;
    const interval = planChoice.interval;
    const perWorkerPence = PRO_PLANS[allowance.tier].extraPence[interval];
    if (interval === 'month') {
      return { ok: true, interval, extrasAfter, perWorkerPence, chargeNowPence: null, renewalExtrasPence: null };
    }

    const existing = subscription.items.data.find((i) => isExtraWorkerPrice(i.price.id));
    const extraPriceId = extraWorkerPriceIdFor(allowance.tier, interval);
    if (!existing && !extraPriceId) return { ok: false };

    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const preview = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscription.id,
      subscription_details: {
        items: [
          existing
            ? { id: existing.id, quantity: extrasAfter }
            : { price: extraPriceId as string, quantity: extrasAfter },
        ],
        proration_behavior: 'always_invoice',
        proration_date: await stripeNowUnix(stripe, subscription),
      },
    });
    const chargeNowPence = chargeNowFromPreviewLines(
      (preview.lines?.data ?? []).map((line) => ({
        amount: (line as PreviewLine).amount ?? 0,
        proration: isProrationLine(line as PreviewLine),
      })),
    );
    return {
      ok: true,
      interval,
      extrasAfter,
      perWorkerPence,
      chargeNowPence,
      renewalExtrasPence: extrasAfter * perWorkerPence,
    };
  } catch (err) {
    console.error('[extra-workers-preview]', err instanceof Error ? err.name : 'Error');
    return { ok: false };
  }
}
