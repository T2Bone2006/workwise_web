// Creates a TEST-mode Stripe customer with a test card and a Pro subscription (plan line plus an
// extra-worker line), and leaves it there, so the Pro Plan & billing page has something real to show.
// Prints the ids and the SQL to point a test business at it (and the SQL to put it back).
//
//   npm run stripe:pro-test-subscription                       (Pro plan, 3 extra workers)
//   npm run stripe:pro-test-subscription -- --tier starter --extra 2
//
// TEST keys only. Nothing here touches Supabase; you paste the SQL it prints.
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.error('This only runs with a TEST key (sk_test_...).');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const tier = flag('tier', 'pro');
const extra = Number.parseInt(flag('extra', '3'), 10);
if (!['starter', 'growth', 'pro'].includes(tier) || !Number.isInteger(extra) || extra < 0) {
  console.error('Usage: --tier starter|growth|pro  --extra <number of extra workers>');
  process.exit(1);
}

const planPrice = process.env[`STRIPE_PRICE_${tier.toUpperCase()}`];
const extraPrice = process.env[`STRIPE_PRICE_EXTRA_WORKER_${tier.toUpperCase()}`];
if (!planPrice || !extraPrice) {
  console.error(`STRIPE_PRICE_${tier.toUpperCase()} and STRIPE_PRICE_EXTRA_WORKER_${tier.toUpperCase()} must be set.`);
  process.exit(1);
}

const stripe = new Stripe(key, { appInfo: { name: 'WorkWise test subscription', url: 'https://joinworkwise.com' } });

const customer = await stripe.customers.create({
  name: 'Pro Test (Stripe test mode)',
  email: 'tayloreden2006+protest@gmail.com',
  metadata: { workwise_test: 'pro-test' },
});
const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });

const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: planPrice }, ...(extra > 0 ? [{ price: extraPrice, quantity: extra }] : [])],
  metadata: { workwise_test: 'pro-test' },
});

console.log(`Stripe key: test`);
console.log(`customer      ${customer.id}`);
console.log(`subscription  ${subscription.id}  (${subscription.status})`);
console.log(`plan price    ${planPrice}  (${tier})`);
console.log(`extra workers ${extra}\n`);

console.log(`-- Paste in the Supabase SQL Editor. Set v_name to the test business's name.
DO $$
DECLARE
  v_name constant text := 'PUT-THE-TEST-BUSINESS-NAME-HERE';
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE name = v_name;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No business named %', v_name; END IF;
  IF (SELECT count(*) FROM public.tenants WHERE name = v_name) > 1 THEN RAISE EXCEPTION 'Several businesses named %', v_name; END IF;
  IF v_name ILIKE '%RS Locksmiths%' OR v_name ILIKE '%Eden%' THEN RAISE EXCEPTION 'Not a test business'; END IF;

  UPDATE public.tenants SET stripe_customer_id = '${customer.id}' WHERE id = v_tenant;

  UPDATE public.subscriptions
  SET source = 'stripe', status = 'active',
      stripe_customer_id = '${customer.id}',
      stripe_subscription_id = '${subscription.id}',
      stripe_price_id = '${planPrice}',
      product = '${tier}'
  WHERE tenant_id = v_tenant AND stripe_subscription_id IS NULL AND status IN ('manual','active')
    AND product IN ('starter','growth','pro');
  IF NOT FOUND THEN RAISE EXCEPTION 'No Pro subscription without a Stripe link found for %', v_name; END IF;
END $$;

-- To put it back (manual Pro again):
-- UPDATE public.subscriptions SET source='manual', status='manual', stripe_customer_id=NULL,
--   stripe_subscription_id=NULL, stripe_price_id=NULL, product='pro', included_workers_override=NULL
--   WHERE stripe_subscription_id = '${subscription.id}';
-- UPDATE public.tenants SET stripe_customer_id = NULL WHERE stripe_customer_id = '${customer.id}';`);
