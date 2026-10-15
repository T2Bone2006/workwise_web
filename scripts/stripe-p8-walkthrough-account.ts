/**
 * Test-mode helper for the Phase 8 walkthrough: makes a self-serve Pro business WITHOUT typing a card into Stripe's
 * hosted Checkout page. It does what Checkout + the webhook would: creates the login, the signup intent, a Stripe test
 * customer (on its own test clock) with the 4242 test card, a subscription with exactly the lines and metadata the real
 * Checkout body carries (buildProCheckoutBody), then runs the real provisioning (provisionFromCheckoutSession) and the
 * first-invoice referral hook. Test keys only; the Checkout page itself is walked by the owner (rows 1-2).
 *
 *   npm run stripe:p8-account -- --email you+p8x@gmail.com --tier growth --interval month --workers 40 \
 *       [--business "Name"] [--ref ABCDEFGH]
 * The password is WALKTHROUGH_PASSWORD from the environment, or the test default below.
 */
import Stripe from 'stripe';
import { createAdminClient } from '../lib/supabase/admin';
import { buildProCheckoutBody } from '../lib/billing/pro-checkout';
import { provisionFromCheckoutSession } from '../lib/stripe/provision';
import { onInvoicePaid } from '../lib/billing/referrals';
import { lookupReferrer, normaliseReferralCode } from '../lib/billing/offers';
import { isProTier, type ProTier } from '../lib/billing/pro-plans';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.error('Test mode only.');
  process.exit(1);
}
const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const email = flag('email')?.toLowerCase() ?? '';
const tier = (flag('tier', 'growth') ?? 'growth') as ProTier;
const interval = flag('interval', 'month') as 'month' | 'year';
const workers = Number.parseInt(flag('workers', '1') ?? '1', 10);
const business = flag('business', `Walkthrough ${tier} ${interval}`)!;
const refCode = normaliseReferralCode(flag('ref'));
const password = process.env.WALKTHROUGH_PASSWORD ?? 'WorkWise-test-8!';
if (!email || !isProTier(tier) || !['month', 'year'].includes(interval)) {
  console.error('Usage: --email <addr> --tier starter|growth|pro --interval month|year --workers <n> [--business <name>] [--ref <code>]');
  process.exit(1);
}

async function main() {
  const stripe = new Stripe(key!, { appInfo: { name: 'WorkWise walkthrough', url: 'https://joinworkwise.com' } });
  const admin = createAdminClient();

  const created = await admin.auth.admin.createUser({ email: email!, password, email_confirm: true, user_metadata: { full_name: 'Walkthrough Owner' } });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const referrer = refCode ? await lookupReferrer(refCode) : null;
  if (refCode && !referrer) throw new Error(`no referrer for ${refCode}`);

  const { data: intent, error: intentError } = await admin
    .from('signup_intents')
    .insert({
      auth_user_id: created.data.user.id,
      email,
      product: tier,
      billing_interval: interval,
      business_name: business,
      full_name: 'Walkthrough Owner',
      phone: '07700900000',
      postcode: null,
      trade: 'other',
      expected_workers: workers,
      referral_code: referrer?.code ?? null,
      referrer_tenant_id: referrer?.tenantId ?? null,
      offer: 'none',
    })
    .select('id')
    .single();
  if (intentError || !intent) throw new Error(`intent: ${intentError?.message}`);

  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `p8 ${email}` });
  const customer = await stripe.customers.create({
    email,
    name: business,
    phone: '07700900000',
    test_clock: clock.id,
    metadata: { signup_intent_id: intent.id, tier, interval, kind: 'pro_signup', contact_name: 'Walkthrough Owner' },
  });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  await admin.from('signup_intents').update({ stripe_customer_id: customer.id }).eq('id', intent.id);

  // The exact Checkout body the app builds: its lines and subscription metadata become the subscription.
  const body = buildProCheckoutBody({ customerId: customer.id, intentId: intent.id, choice: { tier, interval }, appUrl: 'http://localhost:3000', workers });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: (body.line_items ?? []).map((l) => ({ price: l.price as string, quantity: l.quantity as number })),
    metadata: (body.subscription_data?.metadata ?? {}) as Record<string, string>,
    expand: ['latest_invoice'],
  });
  const invoice = subscription.latest_invoice as Stripe.Invoice;
  if (invoice.status !== 'paid') throw new Error(`first invoice is ${invoice.status}`);

  const session = {
    id: `cs_walkthrough_${intent.id}`,
    client_reference_id: intent.id,
    mode: 'subscription',
    subscription: subscription.id,
    customer: customer.id,
    invoice: invoice.id,
    metadata: {},
  } as unknown as Stripe.Checkout.Session;
  const tenantId = await provisionFromCheckoutSession(session);
  await onInvoicePaid(await stripe.invoices.retrieve(invoice.id!));

  console.log(JSON.stringify({ email, password, business, tenantId, tier, interval, workers, charged: invoice.amount_paid / 100, customer: customer.id, subscription: subscription.id, clock: clock.id }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
