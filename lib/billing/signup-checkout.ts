import type Stripe from 'stripe';
import { PLANS, priceIdFor, priceLabel, type PlanChoice } from '@/lib/billing/plans';
import { founderCouponId, type SignupOffer } from '@/lib/billing/offers';

/**
 * Checkout for Rounds, Lite, or both. The price and the trial length come from the server, never the browser.
 * Everyone gets a free trial with the card taken up front; the card is charged when it ends. The founder
 * discount goes on the Checkout only when places were just confirmed free (so Stripe's page shows the real price);
 * otherwise the webhook attaches it after a place has been claimed atomically.
 */
export function signupCheckoutBody(input: {
  customerId: string;
  intentId: string;
  choice: PlanChoice;
  offer: SignupOffer;
  appUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  const { plan, interval } = input.choice;
  return {
    mode: 'subscription',
    customer: input.customerId,
    client_reference_id: input.intentId,
    line_items: [{ price: priceIdFor(input.choice), quantity: 1 }],
    subscription_data: {
      trial_period_days: input.offer.trialDays,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: {
        signup_intent_id: input.intentId,
        plan,
        interval,
        offer: input.offer.offer,
        founder_requested: input.offer.founder ? '1' : '0',
        founder_coupon_shown: input.offer.couponAtCheckout ? '1' : '0',
        trial_days: String(input.offer.trialDays),
      },
    },
    // Places were left a moment ago, so Stripe's page shows the half price. The place itself is still claimed by the
    // webhook; whoever was shown the price keeps it (see claimFounderPlace).
    // Stripe refuses discounts and allow_promotion_codes together, even when it is false, so send only one.
    ...(input.offer.couponAtCheckout ? { discounts: [{ coupon: founderCouponId() }] } : { allow_promotion_codes: false }),
    payment_method_collection: 'always',
    success_url: `${input.appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.appUrl}/signup?plan=${plan}&interval=${interval}&canceled=1`,
    custom_text: {
      submit: {
        message: input.offer.headline || `${PLANS[plan].label}: ${priceLabel(input.choice)} after your free trial. Cancel any time.`,
      },
    },
  };
}
