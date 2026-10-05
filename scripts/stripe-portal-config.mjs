import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}

const mode = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unknown';
console.log(`Stripe key: ${mode}`);

const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
if (!appUrl) {
  console.error('Refusing to run: NEXT_PUBLIC_APP_URL is not set.');
  process.exit(1);
}

const stripe = new Stripe(key);
const config = await stripe.billingPortal.configurations.create({
  business_profile: {
    headline: 'WorkWise billing',
    privacy_policy_url: 'https://joinworkwise.com/privacy',
    terms_of_service_url: 'https://joinworkwise.com/terms',
  },
  default_return_url: `${appUrl}/settings?tab=billing`,
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: { enabled: false },
    subscription_cancel: { enabled: false },
    subscription_update: { enabled: false },
  },
});

console.log(`STRIPE_PORTAL_CONFIGURATION_ID=${config.id}`);
