/**
 * Test-mode edge checks for the trial + founder work (2026-11-17). Read-mostly; the race check inserts and removes
 * its own founder_places rows for businesses named "Trial test %" / "Edge %" only. Test keys only.
 *   npm run stripe:trial-edges -- static
 *   npm run stripe:trial-edges -- race
 *   npm run stripe:trial-edges -- planchange --email x@y   (a TRIALING founder subscription made with stripe:trial signup)
 *   npm run stripe:trial-edges -- downgrade --email x@y    (a trialing "both" subscription)
 */
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '../lib/supabase/admin';
import { PLANS, priceIdFor, type BillingInterval, type PlanKey } from '../lib/billing/plans';
import { teamPriceIdFor } from '../lib/billing/rounds-team-core';
import { prorationFor } from '../lib/billing/extra-workers-core';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.error('Test mode only.');
  process.exit(1);
}
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const stripe = new Stripe(key);
const admin = createAdminClient();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

async function staticChecks() {
  const coupon = await stripe.coupons.retrieve(process.env.STRIPE_COUPON_FOUNDER!, { expand: ['applies_to'] });
  const products = new Set(coupon.applies_to?.products ?? []);
  check('coupon is 50% for ever', coupon.percent_off === 50 && coupon.duration === 'forever');
  check('coupon has no redemption cap (we count the 200 ourselves)', coupon.max_redemptions == null);
  for (const plan of ['rounds', 'lite', 'both'] as PlanKey[]) {
    for (const interval of ['month', 'year'] as BillingInterval[]) {
      const price = await stripe.prices.retrieve(priceIdFor({ plan, interval }));
      const productId = typeof price.product === 'string' ? price.product : price.product.id;
      check(
        `${plan}/${interval}: Stripe price ${price.unit_amount} = list price ${PLANS[plan].pence[interval]}, and the coupon covers its product`,
        price.unit_amount === PLANS[plan].pence[interval] && products.has(productId),
      );
    }
  }
  for (const interval of ['month', 'year'] as BillingInterval[]) {
    const id = teamPriceIdFor(interval);
    if (!id) {
      check(`team ${interval} price configured`, false);
      continue;
    }
    const price = await stripe.prices.retrieve(id);
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    check(`team ${interval} line (${price.unit_amount}) is NOT discounted by the founder coupon`, !products.has(productId));
  }
  console.log('SKIP  Anglesey Windows: their subscription is in live-mode Stripe; this script only holds a test key and never touches it');
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const taken = await anon.rpc('founder_places_taken');
  check('a visitor (anon key) cannot call founder_places_taken', !!taken.error, taken.error?.message?.slice(0, 60));
  const claim = await anon.rpc('claim_founder_place', { p_tenant_id: '00000000-0000-0000-0000-000000000000', p_subscription_id: 'x', p_limit: 200 });
  check('a visitor cannot claim a place', !!claim.error, claim.error?.message?.slice(0, 60));
  const rows = await anon.from('founder_places').select('*');
  check('a visitor cannot read the table', !!rows.error || (rows.data ?? []).length === 0);
  const garbage = await admin.rpc('claim_founder_place', { p_tenant_id: '00000000-0000-0000-0000-000000000000', p_subscription_id: 'x', p_limit: 200 });
  check('claiming for a business that does not exist is refused (no stray row)', !!garbage.error);
}

async function race() {
  const { data: tenants } = await admin.from('tenants').select('id, name').or('name.like.Trial test %,name.like.Edge %').limit(8);
  const ids = (tenants ?? []).map((t) => t.id as string);
  const { data: held } = await admin.from('founder_places').select('tenant_id').is('released_at', null);
  const free = ids.filter((id) => !(held ?? []).some((h) => h.tenant_id === id));
  const takenNow = (held ?? []).length;
  if (free.length < 4) throw new Error(`need 4 businesses without a place, have ${free.length}`);
  const limit = takenNow + 1;
  const results = await Promise.all(free.slice(0, 6).map((id) => admin.rpc('claim_founder_place', { p_tenant_id: id, p_subscription_id: 'sub_race', p_limit: limit })));
  const answers = results.map((r) => r.data as string);
  console.log(' answers:', answers.join(', '));
  check('people finishing at the same instant with 1 place left: exactly 1 gets it, nobody else', answers.filter((a) => a === 'claimed').length === 1 && answers.every((a) => ['claimed', 'full', 'used'].includes(a)));
  const { data: after } = await admin.rpc('founder_places_taken');
  check('the count went up by exactly 1', after === takenNow + 1, `${takenNow} -> ${after}`);
  await admin.from('founder_places').delete().in('tenant_id', free).eq('stripe_subscription_id', 'sub_race');
  const { data: back } = await admin.rpc('founder_places_taken');
  check('test rows removed, count back to what it was', back === takenNow);
}

async function trialingSub(email: string) {
  const { data } = await admin.from('signup_intents').select('stripe_customer_id').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const subs = await stripe.subscriptions.list({ customer: data!.stripe_customer_id as string, status: 'all', limit: 1, expand: ['data.discounts'] });
  return subs.data[0];
}

async function planchange() {
  const email = flag('email')!;
  let sub = await trialingSub(email);
  check('starts trialing with the founder coupon', sub.status === 'trialing' && (sub.discounts as Stripe.Discount[]).length === 1);
  const trialEnd = sub.trial_end;
  const itemId = sub.items.data[0].id;

  // Same calls the app makes for "add Lite" (an upgrade now) on a monthly plan.
  const preview = await stripe.invoices.createPreview({
    customer: sub.customer as string,
    subscription: sub.id,
    subscription_details: { items: [{ id: itemId, price: priceIdFor({ plan: 'both', interval: 'month' }) }], proration_behavior: 'always_invoice' },
  });
  check('preview of "add Lite" during the trial says £0 today', preview.amount_due === 0, `due ${preview.amount_due}`);

  sub = await stripe.subscriptions.update(sub.id, {
    items: [{ id: itemId, price: priceIdFor({ plan: 'both', interval: 'month' }) }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
    expand: ['latest_invoice', 'discounts'],
  });
  const inv = sub.latest_invoice as Stripe.Invoice;
  check('upgrade to both during the trial: still trialing, same trial end, nothing charged', sub.status === 'trialing' && sub.trial_end === trialEnd && inv.amount_paid === 0, `${sub.status}, invoice ${inv.amount_due}`);
  check('founder coupon survived the upgrade', (sub.discounts as Stripe.Discount[]).some((d) => d.source?.coupon === process.env.STRIPE_COUPON_FOUNDER));

  // Two team lines added the way rounds-team.ts adds them.
  await stripe.subscriptionItems.create({
    subscription: sub.id,
    price: teamPriceIdFor('month')!,
    quantity: 2,
    proration_behavior: prorationFor('month'),
  });
  sub = await stripe.subscriptions.retrieve(sub.id);
  check('adding 2 team lines during the trial keeps the trial and charges nothing yet', sub.status === 'trialing' && sub.trial_end === trialEnd);
  const upcoming = await stripe.invoices.createPreview({ customer: sub.customer as string, subscription: sub.id });
  console.log(' first real bill preview:', upcoming.lines.data.map((l) => `${l.amount / 100}`).join(' + '), '=', upcoming.amount_due / 100);
  const teamUnit = (await stripe.prices.retrieve(teamPriceIdFor('month')!)).unit_amount ?? 0;
  check(`first bill = £29.50 (both, half price) + 2 x £${teamUnit / 100} (team lines, NOT halved) = £${(2950 + 2 * teamUnit) / 100}`, upcoming.amount_due === 2950 + 2 * teamUnit, `${upcoming.amount_due / 100}`);

  // Yearly during trial: the app refuses before calling Stripe (manage.ts YEARLY_AFTER_TRIAL); prove the premise.
  check('premise for the yearly block: subscription is trialing', sub.status === 'trialing');
}

async function downgrade() {
  const email = flag('email')!;
  const sub = await trialingSub(email);
  check('starts trialing', sub.status === 'trialing');
  const founder = (sub.discounts as Stripe.Discount[]).find((d) => d.source?.coupon === process.env.STRIPE_COUPON_FOUNDER);
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
  const phase0 = schedule.phases[0];
  const periodEnd = sub.items.data[0].current_period_end;
  // Same shape as applyDowngrade in lib/billing/manage.ts (trial kept on phase 1, founder discount carried to phase 2).
  const updated = await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    proration_behavior: 'none',
    phases: [
      {
        items: [{ price: sub.items.data[0].price.id, quantity: 1 }],
        start_date: phase0.start_date,
        end_date: periodEnd,
        ...(sub.trial_end ? { trial_end: sub.trial_end } : {}),
        discounts: founder ? [{ discount: founder.id }] : undefined,
        proration_behavior: 'none',
      },
      {
        items: [{ price: priceIdFor({ plan: 'rounds', interval: 'month' }), quantity: 1 }],
        duration: { interval: 'month', interval_count: 1 },
        discounts: founder ? [{ discount: founder.id }] : undefined,
        proration_behavior: 'none',
      },
    ],
  });
  check('downgrade booked for when the trial ends (two phases)', updated.phases.length === 2);
  const after = await stripe.subscriptions.retrieve(sub.id);
  check('still trialing with the same trial end', after.status === 'trialing' && after.trial_end === sub.trial_end, `${after.status}`);
  const invoices = await stripe.invoices.list({ customer: sub.customer as string, limit: 5 });
  check('no invoice was raised by booking it', invoices.data.every((i) => i.amount_due === 0));
  const phase2 = updated.phases[1];
  check('the founder discount is on the new plan too', (phase2.discounts ?? []).length === 1);
}

const commands: Record<string, () => Promise<void>> = { static: staticChecks, race, planchange, downgrade };
(commands[command] ?? (async () => console.error('commands: static | race | planchange | downgrade')))()
  .then(() => {
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
