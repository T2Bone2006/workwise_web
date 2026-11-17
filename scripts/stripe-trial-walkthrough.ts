/**
 * Test-mode helper for the trial + founder walkthrough (2026-11-17). Test keys only.
 * It does what hosted Checkout + Stripe's webhook would, without typing a card:
 *   signup   makes a login, a signup intent, a test-clock customer with the 4242 card, and a subscription built from the
 *            REAL signupCheckoutBody (trial days, metadata), then sends a signed checkout.session.completed to the running app.
 *   events   replays Stripe's events for a customer to the running app's webhook route (signed with the app's secret).
 *   advance  moves a customer's test clock forward N days and waits until it is ready.
 *   cancel   cancels a subscription (as the customer would from the portal).
 *   status   prints the tenant, founder place, subscription and invoices for an email.
 *
 *   npm run stripe:trial -- signup --email a+t1@gmail.com [--plan rounds|lite|both] [--interval month|year] [--ref CODE] [--force-founder 0|1]
 *   npm run stripe:trial -- events --email a+t1@gmail.com
 *   npm run stripe:trial -- advance --email a+t1@gmail.com --days 28
 *   npm run stripe:trial -- cancel --email a+t1@gmail.com
 *   npm run stripe:trial -- status --email a+t1@gmail.com
 * Needs WALKTHROUGH_PASSWORD for signup, and the dev server on APP_URL.
 */
import Stripe from 'stripe';
import { createAdminClient } from '../lib/supabase/admin';
import { chooseSignupOffer, FOUNDING_PLACES } from '../lib/billing/offers';
import { signupCheckoutBody } from '../lib/billing/signup-checkout';
import { parsePlanChoice } from '../lib/billing/plans';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.error('Test mode only.');
  process.exit(1);
}
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
};
const email = flag('email')?.toLowerCase() ?? '';
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const stripe = new Stripe(key, { appInfo: { name: 'WorkWise walkthrough', url: 'https://joinworkwise.com' } });
const admin = createAdminClient();

async function customerFor(addr: string) {
  // The intent row has the id straight away; Stripe's email search can lag behind a new customer.
  const { data } = await admin.from('signup_intents').select('stripe_customer_id').eq('email', addr).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data?.stripe_customer_id) throw new Error(`no Stripe customer for ${addr}`);
  return stripe.customers.retrieve(data.stripe_customer_id) as Promise<Stripe.Customer>;
}

async function postSigned(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  const res = await fetch(`${appUrl}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'stripe-signature': header, 'content-type': 'application/json' },
    body: payload,
  });
  return `${res.status} ${(await res.text()).slice(0, 160)}`;
}

async function signup() {
  const password = process.env.WALKTHROUGH_PASSWORD;
  if (!password || !email) throw new Error('Need --email and WALKTHROUGH_PASSWORD');
  const choice = parsePlanChoice({ plan: flag('plan', 'rounds'), interval: flag('interval', 'month') });
  const refCode = flag('ref');

  const { data: taken } = await admin.rpc('founder_places_taken');
  const placesLeft = Math.max(0, FOUNDING_PLACES - (taken as number));
  const forced = flag('force-founder');
  const founderStatus =
    forced === undefined
      ? { active: placesLeft > 0, placesLeft, places: FOUNDING_PLACES }
      : { active: forced === '1', placesLeft: forced === '1' ? 1 : 0, places: FOUNDING_PLACES };
  const offer = chooseSignupOffer({ choice, founding: founderStatus, referred: !!refCode });

  let referrerTenantId: string | null = null;
  if (refCode) {
    const { data } = await admin.from('tenants').select('id').eq('referral_code', refCode).maybeSingle();
    if (!data) throw new Error(`unknown referral code ${refCode}`);
    referrerTenantId = data.id as string;
  }

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Trial Test Owner' } });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const business = `Trial test ${email.split('+')[1]?.split('@')[0] ?? 'biz'}`;
  const { data: intent, error } = await admin
    .from('signup_intents')
    .insert({
      auth_user_id: created.data.user.id,
      email,
      product: choice.plan,
      billing_interval: choice.interval,
      business_name: business,
      full_name: 'Trial Test Owner',
      phone: '07700900000',
      postcode: 'LS6 1AA',
      trade: null,
      referral_code: refCode ?? null,
      referrer_tenant_id: referrerTenantId,
      offer: offer.offer,
    })
    .select('id')
    .single();
  if (error || !intent) throw new Error(`intent: ${error?.message}`);

  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `trial ${email}` });
  const customer = await stripe.customers.create({
    email,
    name: business,
    test_clock: clock.id,
    metadata: { signup_intent_id: intent.id, plan: choice.plan, interval: choice.interval, contact_name: 'Trial Test Owner' },
  });
  const pm = await stripe.paymentMethods.attach(flag('card', 'pm_card_visa')!, { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  await admin.from('signup_intents').update({ stripe_customer_id: customer.id }).eq('id', intent.id);

  // The real Checkout body decides the line, trial length and metadata; a subscription takes the same fields.
  const body = signupCheckoutBody({ customerId: customer.id, intentId: intent.id, choice, offer, appUrl });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: body.line_items![0].price as string, quantity: 1 }],
    trial_period_days: body.subscription_data!.trial_period_days,
    trial_settings: body.subscription_data!.trial_settings,
    metadata: body.subscription_data!.metadata,
  });

  const session = {
    id: `cs_walkthrough_${intent.id}`,
    object: 'checkout.session',
    client_reference_id: intent.id,
    mode: 'subscription',
    subscription: subscription.id,
    customer: customer.id,
    invoice: null,
    metadata: {},
  };
  const reply = await postSigned({
    id: `evt_walk_${intent.id.replace(/-/g, '').slice(0, 20)}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  });
  console.log(JSON.stringify({ email, business, offer: offer.offer, trialDays: offer.trialDays, founderRequested: offer.founder, subscription: subscription.id, status: subscription.status, clock: clock.id, webhook: reply }, null, 2));
}

async function events() {
  const customer = await customerFor(email);
  const list = await stripe.events.list({ limit: 100, created: { gte: Math.floor(Date.now() / 1000) - 3 * 3600 } });
  const mine = list.data
    .filter((e) => JSON.stringify(e.data.object).includes(customer.id))
    .filter((e) => /^(checkout\.session\.completed|customer\.subscription\.|invoice\.paid|invoice\.payment_failed)/.test(e.type))
    .reverse();
  for (const e of mine) console.log(e.type.padEnd(42), await postSigned(e as unknown as Record<string, unknown>));
  if (!mine.length) console.log('no events');
}

async function advance() {
  const customer = await customerFor(email);
  const clockId = typeof customer.test_clock === 'string' ? customer.test_clock : customer.test_clock?.id;
  if (!clockId) throw new Error('customer has no test clock');
  const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
  const days = Number(flag('days', '1'));
  try {
    await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: clock.frozen_time + days * 86400 });
  } catch (err) {
    console.log('advance call said:', (err as Error).message);
  }
  for (let i = 0; i < 40; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (c.status === 'ready') {
      console.log(`clock ready at ${new Date(c.frozen_time * 1000).toISOString()}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('clock still advancing');
}

async function cancel() {
  const customer = await customerFor(email);
  const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 5 });
  for (const s of subs.data) if (s.status !== 'canceled') console.log('cancelled', (await stripe.subscriptions.cancel(s.id)).id);
}

async function status() {
  const customer = await customerFor(email);
  const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 5, expand: ['data.discounts'] });
  for (const s of subs.data) {
    console.log('subscription', s.id, s.status, 'trial_end', s.trial_end ? new Date(s.trial_end * 1000).toISOString() : null, 'meta', JSON.stringify(s.metadata));
    console.log('  discounts', JSON.stringify((s.discounts as Stripe.Discount[]).map((d) => d.source?.coupon ?? d.id)));
    console.log('  items', s.items.data.map((i) => `${i.price.unit_amount} x${i.quantity}`).join(', '));
  }
  const inv = await stripe.invoices.list({ customer: customer.id, limit: 5 });
  for (const i of inv.data) console.log('invoice', i.id, i.status, 'paid', i.amount_paid / 100, 'due', i.amount_due / 100);
  const { data: tenant } = await admin.from('tenants').select('id, name, referral_code').eq('stripe_customer_id', customer.id).maybeSingle();
  console.log('tenant', JSON.stringify(tenant));
  if (tenant) {
    const { data: fp } = await admin.from('founder_places').select('*').eq('tenant_id', tenant.id);
    console.log('founder_places', JSON.stringify(fp));
  }
  const { data: taken } = await admin.rpc('founder_places_taken');
  console.log('places taken', taken);
}

async function detach() {
  const customer = await customerFor(email);
  const pms = await stripe.paymentMethods.list({ customer: customer.id, type: 'card' });
  for (const pm of pms.data) await stripe.paymentMethods.detach(pm.id);
  console.log('cards removed', pms.data.length);
}

const commands: Record<string, () => Promise<void>> = { signup, events, advance, cancel, status, detach };
(commands[command] ?? (async () => console.error('commands: signup | events | advance | cancel | status')))().catch((err) => {
  console.error(err);
  process.exit(1);
});
