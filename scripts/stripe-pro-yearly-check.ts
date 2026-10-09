/**
 * End-to-end check of "Switch to yearly" for a Pro plan against Stripe TEST mode, on a test clock.
 *
 * A Growth plan billed monthly from 1 Oct with a team of 38 (3 extra workers), moved to 16 Oct, then switched to
 * yearly through the real previewProYearly / switchProToYearly while the database is faked (nothing in Supabase is
 * written). Checks the amounts against the owner's agreed example, that the year starts on the day of the switch,
 * that a double click and a stale amount cannot charge wrongly, and that the first renewal a year later is the full
 * yearly price. Everything created in Stripe is removed at the end (--keep leaves it).
 *
 *   npm run stripe:pro-yearly-check
 */
import Stripe from 'stripe';
import { previewProYearly, switchProToYearly } from '../lib/billing/pro-manage';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.error('This check runs in TEST mode only.');
  process.exit(1);
}
const E = process.env;
for (const n of ['STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_GROWTH_YEARLY', 'STRIPE_PRICE_EXTRA_WORKER_GROWTH', 'STRIPE_PRICE_EXTRA_WORKER_GROWTH_YEARLY']) {
  if (!E[n]) {
    console.error(`${n} must be set.`);
    process.exit(1);
  }
}
const stripe = new Stripe(key, { appInfo: { name: 'WorkWise check', url: 'https://joinworkwise.com' } });
const keep = process.argv.includes('--keep');
const runId = Date.now();
const day = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d, 12) / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const pounds = (p: number) => `£${(p / 100).toFixed(2)}`;

let subscriptionId = '';
let billingInterval: 'month' | 'year' = 'month';

function fakeSupabase() {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'neq', 'not']) b[m] = () => b;
    b.returns = () =>
      Promise.resolve({
        data:
          table === 'subscriptions'
            ? [{ product: 'growth', source: 'stripe', status: 'active', stripe_subscription_id: subscriptionId, billing_interval: billingInterval, included_workers_override: null }]
            : [],
        error: null,
      });
    b.then = (resolve: (v: { count: number; error: null }) => void) => resolve({ count: 38, error: null });
    return b;
  };
  return { from: (table: string) => builder(table) } as never;
}

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

async function advance(clockId: string, to: number) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  for (let i = 0; i < 60; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (c.status === 'ready') return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('test clock did not become ready');
}

async function main() {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: day(2026, 10, 1), name: 'pro-yearly-check' });
  try {
    const customer = await stripe.customers.create({ test_clock: clock.id, name: 'WorkWise yearly check (safe to delete)', email: 'yearly-check@example.com' });
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: E.STRIPE_PRICE_GROWTH! }, { price: E.STRIPE_PRICE_EXTRA_WORKER_GROWTH!, quantity: 3 }],
    });
    subscriptionId = sub.id;
    const first = await stripe.invoices.retrieve(sub.latest_invoice as string);
    console.log(`1 Oct 2026: Growth monthly + 3 extras, first bill ${pounds(first.amount_paid)}`);
    check('monthly bill is £476.00', first.amount_paid === 47600);

    await advance(clock.id, day(2026, 10, 16));
    console.log('\n16 Oct 2026: preview of the switch');
    const preview = await previewProYearly('check-tenant', fakeSupabase());
    console.log(`  ${JSON.stringify(preview)}`);
    check('preview is ok', preview.ok);
    if (!preview.ok) throw new Error('preview failed');
    check('the yearly bill for this team is £4,760.00', preview.yearlyPence === 476000);
    check('12 monthly bills would have been £5,712.00 and the saving is £952.00', preview.yearOfMonthsPence === 571200 && preview.savesPence === 95200);
    check('3 extras', preview.extras === 3);
    check('the credit for the unused part of October is about £245 (£231.74 + £13.94)', Math.abs(preview.creditPence - 24568) <= 5, pounds(preview.creditPence));
    check('today = £4,760.00 minus the credit', Math.abs(preview.todayPence - (476000 - preview.creditPence)) <= 2, pounds(preview.todayPence));
    check('the next yearly bill is a year from today (16 Oct 2027)', preview.renewsOn.slice(0, 10) === '2027-10-16', preview.renewsOn.slice(0, 10));

    console.log('\nSwitch with a stale amount: must be refused, nothing charged');
    const stale = await switchProToYearly('check-tenant', preview.todayPence + 500, `yearly-stale-${runId}`, fakeSupabase());
    check('refused as "amount has changed"', !stale.ok && stale.error.startsWith('The amount has changed'));
    let live = await stripe.subscriptions.retrieve(subscriptionId);
    check('still monthly', live.items.data.every((i) => i.price.recurring?.interval === 'month'));

    console.log('\nSwitch with the right amount');
    const done = await switchProToYearly('check-tenant', preview.todayPence, `yearly-one-${runId}`, fakeSupabase());
    console.log(`  ${JSON.stringify(done)}`);
    check('switch applied', done.ok && 'applied' in done);
    live = await stripe.subscriptions.retrieve(subscriptionId);
    const plan = live.items.data.find((i) => i.price.id === E.STRIPE_PRICE_GROWTH_YEARLY);
    const extra = live.items.data.find((i) => i.price.id === E.STRIPE_PRICE_EXTRA_WORKER_GROWTH_YEARLY);
    check('plan line is Growth yearly × 1', plan?.quantity === 1);
    check('extra line is the yearly extra price × 3', extra?.quantity === 3);
    check('nothing left on monthly prices', live.items.data.every((i) => i.price.recurring?.interval === 'year'));
    const start = plan?.current_period_start ?? 0;
    const end = plan?.current_period_end ?? 0;
    console.log(`  new period: ${iso(start)} -> ${iso(end)}`);
    check('the year runs from 16 Oct 2026 to 16 Oct 2027', iso(start) === '2026-10-16' && iso(end) === '2027-10-16');
    const inv = (await stripe.invoices.list({ subscription: subscriptionId, limit: 1 })).data[0];
    console.log(`  latest invoice: ${pounds(inv?.amount_paid ?? 0)} ${inv?.status}; the dialog said ${pounds(preview.todayPence)}`);
    check('the card was charged what the dialog showed', inv?.status === 'paid' && Math.abs(inv.amount_paid - preview.todayPence) <= 2);

    console.log('\nSwitch again with the same nonce (a double click) and once already yearly: no second charge');
    billingInterval = 'year';
    const again = await switchProToYearly('check-tenant', preview.todayPence, `yearly-one-${runId}`, fakeSupabase());
    check('refused: already yearly', !again.ok);
    const count = (await stripe.invoices.list({ subscription: subscriptionId, limit: 10 })).data.length;
    check('still only two invoices (first monthly bill and the switch)', count === 2, String(count));

    console.log('\nA year later (16 Oct 2027): the renewal is the full yearly price for the team');
    await advance(clock.id, day(2027, 10, 17));
    const invoices = (await stripe.invoices.list({ subscription: subscriptionId, limit: 10 })).data.sort((a, b) => b.created - a.created);
    const renewal = invoices[0];
    console.log(`  renewal invoice: ${pounds(renewal?.amount_paid ?? 0)} ${renewal?.status}`);
    check('renewal is £4,760.00 and paid', renewal?.amount_paid === 476000 && renewal?.status === 'paid');
    live = await stripe.subscriptions.retrieve(subscriptionId);
    check('still yearly, next renewal 16 Oct 2028', iso(live.items.data[0].current_period_end) === '2028-10-16');
  } finally {
    if (keep) console.log(`\nLeft in Stripe test mode: test clock ${clock.id}`);
    else {
      await stripe.testHelpers.testClocks.del(clock.id).catch(() => undefined);
      console.log('\nCleaned up the test clock, customer and subscription.');
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
