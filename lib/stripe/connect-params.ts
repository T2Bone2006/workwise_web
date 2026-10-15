import type Stripe from 'stripe';

export const CONNECT_API_VERSION = '2026-08-26.preview';

/** The ONE place the connected-account settings live. The app and the probe both use it. */
export function buildConnectAccountParams(p: {
  tenantId: string;
  email: string | null;
  businessName: string;
}): Stripe.AccountCreateParams {
  return {
    country: 'GB',
    ...(p.email ? { email: p.email } : {}),
    controller: {
      stripe_dashboard: { type: 'express' },
      fees: { payer: 'account' },
      losses: { payments: 'stripe' },
      requirement_collection: 'stripe',
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: {
      name: p.businessName,
      // 7349 = Cleaning, Maintenance and Janitorial Services. Prefilled only;
      // the trader can change their industry during onboarding.
      mcc: '7349',
      product_description:
        'Regular home and business services (e.g. window cleaning, gardening) booked and paid through WorkWise.',
    },
    tos_acceptance: { service_agreement: 'full' },
    metadata: { workwise_tenant_id: p.tenantId },
  };
}
