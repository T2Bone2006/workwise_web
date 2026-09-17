import 'server-only';
import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

/**
 * Platform Stripe client (subscriptions, Checkout, Billing Portal, webhooks).
 * Uses the SDK's pinned API version. Connect account creation uses its own
 * client with the preview version — see lib/stripe/connect.ts (Phase 2).
 */
export function getStripe(): Stripe {
  if (stripeSingleton) return stripeSingleton;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  stripeSingleton = new Stripe(secretKey, {
    appInfo: { name: 'WorkWise', url: 'https://joinworkwise.com' },
  });
  return stripeSingleton;
}

export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_APP_URL');
  }
  return url;
}
