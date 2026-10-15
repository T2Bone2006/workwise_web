/**
 * Test-mode helper for the Phase 9 walkthrough: makes a self-serve ROUNDS business WITHOUT typing a card into Stripe's
 * hosted Checkout page (Phase 7 already walked that page). It does what Checkout + the webhook would: creates the login,
 * the signup intent, a Stripe test customer (on its own test clock) with the 4242 test card, a subscription with the same
 * line and metadata the real Checkout body carries (plan price x 1, offer 'none' so the first month is the full £35), then
 * runs the real provisioning. Test keys only.
 *
 *   npm run stripe:p9-account -- --email you+teamowner@gmail.com [--interval month|year] [--business "Name"]
 * The password is WALKTHROUGH_PASSWORD from the environment, or the test default below.
 */
import Stripe from 'stripe';
import { createAdminClient } from '../lib/supabase/admin';
import { priceIdFor, type BillingInterval } from '../lib/billing/plans';
import { provisionFromCheckoutSession } from '../lib/stripe/provision';

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
const interval = (flag('interval', 'month') ?? 'month') as BillingInterval;
const business = flag('business', `Team test ${email.split('+')[1]?.split('@')[0] ?? 'rounds'}`)!;
const password = process.env.WALKTHROUGH_PASSWORD ?? 'WorkWise-test-9!';
if (!email || !['month', 'year'].includes(interval)) {
  console.error('Usage: --email <addr> [--interval month|year] [--business <name>]');
  process.exit(1);
}

async function main() {
  const stripe = new Stripe(key!, { appInfo: { name: 'WorkWise walkthrough', url: 'https://joinworkwise.com' } });
  const admin = createAdminClient();

  const created = await admin.auth.admin.createUser({ email: email!, password, email_confirm: true, user_metadata: { full_name: 'Team Test Owner' } });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);

  const { data: intent, error: intentError } = await admin
    .from('signup_intents')
    .insert({
      auth_user_id: created.data.user.id,
      email,
      product: 'rounds',
      billing_interval: interval,
      business_name: business,
      full_name: 'Team Test Owner',
      phone: '07700900000',
      postcode: 'LS6 1AA',
      trade: null,
      offer: 'none',
    })
    .select('id')
    .single();
  if (intentError || !intent) throw new Error(`intent: ${intentError?.message}`);

  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `p9 ${email}` });
  const customer = await stripe.customers.create({
    email,
    name: business,
    phone: '07700900000',
    test_clock: clock.id,
    metadata: { signup_intent_id: intent.id, plan: 'rounds', interval, contact_name: 'Team Test Owner' },
  });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  await admin.from('signup_intents').update({ stripe_customer_id: customer.id }).eq('id', intent.id);

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceIdFor({ plan: 'rounds', interval }), quantity: 1 }],
    metadata: { signup_intent_id: intent.id, plan: 'rounds', interval, offer: 'none' },
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
  const { data: tenant } = await admin.from('tenants').select('slug').eq('id', tenantId).single();

  console.log(JSON.stringify({ email, business, tenantId, slug: tenant?.slug, interval, charged: invoice.amount_paid / 100, customer: customer.id, subscription: subscription.id, clock: clock.id }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
