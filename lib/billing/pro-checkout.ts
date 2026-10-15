import 'server-only';

import type Stripe from 'stripe';
import { PRO_PLANS, formatPoundsLong, proCost, proPriceLabel, type ProChoice } from '@/lib/billing/pro-plans';
import { EXTRA_WORKER_PRICE_ENV, extraWorkerPriceIdFor, proPlanPriceId } from '@/lib/billing/pro-plan-prices';
import { proRestartLines } from '@/lib/billing/pro-restart-core';

/**
 * Stripe Checkout for a Pro sign-up. Pure body builder (tested without Stripe).
 *
 * The plan, plus an extra-worker line when the team they entered is already past the allowance, so the amount
 * on the card matches "what you pay today". No discount of any kind and no promotion-code box (D3): there is
 * deliberately no `discounts` key at all.
 */
export function buildProCheckoutBody(input: {
  customerId: string;
  intentId: string;
  choice: ProChoice;
  appUrl: string;
  workers?: number | null;
}): Stripe.Checkout.SessionCreateParams {
  const { customerId, intentId, choice, appUrl, workers } = input;
  const plan = PRO_PLANS[choice.tier];
  const team = workers ?? plan.included;
  const cost = proCost(choice, team);
  const cancelParams = new URLSearchParams({ tier: choice.tier, interval: choice.interval });
  if (workers) cancelParams.set('workers', String(workers));
  cancelParams.set('canceled', '1');
  const per = choice.interval === 'month' ? 'a month' : 'a year';

  const extraPriceId = cost.extras > 0 ? extraWorkerPriceIdFor(choice.tier, choice.interval) : null;
  if (cost.extras > 0 && !extraPriceId) {
    const envName = EXTRA_WORKER_PRICE_ENV[choice.tier][choice.interval];
    throw new Error(`Missing ${envName} for ${choice.tier}/${choice.interval}`);
  }

  const message =
    cost.extras > 0
      ? `${plan.name}: ${formatPoundsLong(cost.totalPence)} ${per} (${formatPoundsLong(cost.planPence)} plus ${cost.extras} extra × ${formatPoundsLong(plan.extraPence[choice.interval])}). Cancel any time.`
      : `${plan.name}: ${proPriceLabel(choice)}. Extra workers (${formatPoundsLong(plan.extraPence[choice.interval])} each ${per}) are only added when your team grows past ${plan.included}. Cancel any time.`;

  return {
    mode: 'subscription',
    customer: customerId,
    client_reference_id: intentId,
    line_items: proRestartLines({
      planPriceId: proPlanPriceId(choice),
      extraPriceId,
      teamSize: team,
      included: plan.included,
    }),
    subscription_data: {
      metadata: {
        signup_intent_id: intentId,
        tier: choice.tier,
        interval: choice.interval,
        kind: 'pro_signup',
        ...(cost.extras > 0 ? { expected_workers: String(Math.floor(team)) } : {}),
      },
    },
    allow_promotion_codes: false,
    payment_method_collection: 'always',
    success_url: `${appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/signup/pro?${cancelParams.toString()}`,
    custom_text: {
      submit: { message },
    },
  };
}
