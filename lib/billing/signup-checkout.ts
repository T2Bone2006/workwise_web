import type Stripe from 'stripe';
import { PLANS, priceIdFor, priceLabel, type PlanChoice } from '@/lib/billing/plans';
import { couponIdFor, type SignupOffer } from '@/lib/billing/offers';

/** Checkout for Rounds, Lite, or both. The price and coupon come from the server, never the browser. */
export function signupCheckoutBody(input: {
  customerId: string;
  intentId: string;
  choice: PlanChoice;
  offer: SignupOffer;
  appUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  const coupon = couponIdFor(input.offer);
  const { plan, interval } = input.choice;
  return {
    mode: 'subscription',
    customer: input.customerId,
    client_reference_id: input.intentId,
    line_items: [{ price: priceIdFor(input.choice), quantity: 1 }],
    subscription_data: {
      metadata: {
        signup_intent_id: input.intentId,
        plan,
        interval,
        offer: input.offer.offer,
        ...(input.offer.secondMonthHalf ? { second_month_half: '1' } : {}),
      },
    },
    ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true as const }),
    payment_method_collection: 'always',
    success_url: `${input.appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.appUrl}/signup?plan=${plan}&interval=${interval}&canceled=1`,
    custom_text: {
      submit: {
        message: input.offer.headline ?? `${PLANS[plan].label}: ${priceLabel(input.choice)}. Cancel any time.`,
      },
    },
  };
}
