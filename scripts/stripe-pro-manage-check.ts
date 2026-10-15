/**
 * End-to-end check of Pro upgrade, cancel and undo against Stripe TEST mode.
 *
 * Creates a throwaway test customer with a test card and a monthly Starter subscription carrying an extra-worker line
 * for a team of 40, then runs the real previewProUpgrade / upgradeProTier / cancelProPlan / undoProCancel while the
 * database is faked (only what it reports changes: nothing in Supabase is written; the sync finds no business for the
 * throwaway customer and writes nothing). Everything created in Stripe is removed at the end (--keep leaves it).
 *
 *   npm run stripe:pro-manage-check
 */
import Stripe from 'stripe';
import { previewProUpgrade, upgradeProTier, cancelProPlan, undoProCancel } from '../lib/billing/pro-manage';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.error('This check runs in TEST mode only.');
  process.exit(1);
}
const need = ['STRIPE_PRICE_STARTER', 'STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_EXTRA_WORKER_STARTER', 'STRIPE_PRICE_EXTRA_WORKER_GROWTH'] as const;
for (const n of need) {
  if (!process.env[n]) {
    console.error(`${n} must be set.`);
    process.exit(1);
  }
}
const stripe = new Stripe(key, { appInfo: { name: 'WorkWise check', url: 'https://joinworkwise.com' } });
const keep = process.argv.includes('--keep');

let subscriptionId = '';
const runId = Date.now(); // idempotency keys are remembered by Stripe for a day: never reuse one across runs
let teamSize = 40;

function fakeSupabase() {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'neq', 'not']) b[m] = () => b;
    b.returns = () =>
      Promise.resolve({
        data:
          table === 'subscriptions'
            ? [{ product: 'starter', source: 'stripe', status: 'active', stripe_subscription_id: subscriptionId, billing_interval: 'month', included_workers_override: null }]
            : [],
        error: null,
      });
    b.then = (resolve: (v: { count: number; error: null }) => void) => resolve({ count: teamSize, error: null });
    return b;
  };
  return { from: (table: string) => builder(table) } as never;
}

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

async function lines() {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return { sub, items: sub.items.data.map((i) => ({ price: i.price.id, quantity: i.quantity ?? 0 })) };
}

async function main() {
  const customer = await stripe.customers.create({ name: 'WorkWise Pro manage check (safe to delete)', email: 'pro-manage-check@example.com' });
  try {
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_STARTER! }, { price: process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER!, quantity: 30 }],
    });
    subscriptionId = sub.id;
    console.log(`Test customer ${customer.id}, Starter subscription ${sub.id} with 30 extra workers (team of 40)`);

    console.log('\nPreview: upgrade to Growth (35 included, so 5 extras)');
    const preview = await previewProUpgrade('check-tenant', 'growth', fakeSupabase());
    console.log(`  ${JSON.stringify(preview)}`);
    check('preview is ok', preview.ok);
    if (!preview.ok) throw new Error('preview failed');
    check('the extra line shrinks to 5 workers', preview.overAfter === 5);

    console.log('\nUpgrade (with a stale amount: must be refused, nothing charged)');
    const stale = await upgradeProTier('check-tenant', 'growth', preview.todayPence + 500, `check-stale-${runId}`, fakeSupabase());
    check('refused as "amount has changed"', !stale.ok && stale.error.startsWith('The amount has changed'));
    let state = await lines();
    check('still Starter with 30 extras', state.items.some((i) => i.price === process.env.STRIPE_PRICE_STARTER) && state.items.some((i) => i.quantity === 30));

    console.log('\nUpgrade (with the right amount)');
    const done = await upgradeProTier('check-tenant', 'growth', preview.todayPence, `check-one-${runId}`, fakeSupabase());
    console.log(`  ${JSON.stringify(done)}`);
    check('upgrade applied', done.ok && 'applied' in done);
    state = await lines();
    console.log(`  lines: ${state.items.map((i) => `${i.price.slice(-6)}×${i.quantity}`).join(', ')}`);
    check('plan line is Growth', state.items.some((i) => i.price === process.env.STRIPE_PRICE_GROWTH && i.quantity === 1));
    check('extra line is the Growth extra price × 5', state.items.some((i) => i.price === process.env.STRIPE_PRICE_EXTRA_WORKER_GROWTH && i.quantity === 5));
    check('nothing left on the Starter prices', !state.items.some((i) => i.price === process.env.STRIPE_PRICE_STARTER || i.price === process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER));
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, limit: 1 });
    const latest = invoices.data[0];
    console.log(`  latest invoice: £${((latest?.amount_due ?? 0) / 100).toFixed(2)} ${latest?.status}`);
    check('the card was charged what the dialog showed', latest?.status === 'paid' && Math.abs(latest.amount_due - preview.todayPence) <= 2, `preview ${preview.todayPence}, invoice ${latest?.amount_due}`);

    console.log('\nUpgrade again with the same nonce (a double click): must not charge twice');
    const again = await upgradeProTier('check-tenant', 'growth', preview.todayPence, `check-one-${runId}`, fakeSupabase());
    console.log(`  ${JSON.stringify(again)}`);
    check('refused: already on Growth', !again.ok);

    console.log('\nUpgrade to Pro with a team of 20 (70 included): the extra line goes away');
    teamSize = 20;
    const up2 = await upgradeProTier('check-tenant', 'pro', (await previewProUpgrade('check-tenant', 'pro', fakeSupabase())).ok ? (await previewProUpgrade('check-tenant', 'pro', fakeSupabase()) as { todayPence: number }).todayPence : 0, `check-two-${runId}`, fakeSupabase());
    check('upgrade to Pro applied', up2.ok);
    state = await lines();
    check('plan line is Pro and no extra line remains', state.items.length === 1 && state.items[0].price === process.env.STRIPE_PRICE_PRO);

    console.log('\nA second subscription: Starter with a team of 8, upgraded to Growth (an upgrade that does cost money today)');
    const sub2 = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: process.env.STRIPE_PRICE_STARTER! }] });
    const firstSubscriptionId = subscriptionId;
    subscriptionId = sub2.id;
    teamSize = 8;
    const preview2 = await previewProUpgrade('check-tenant', 'growth', fakeSupabase());
    console.log(`  ${JSON.stringify(preview2)}`);
    check('preview shows a charge today', preview2.ok && preview2.todayPence > 0);
    if (preview2.ok) {
      const done2 = await upgradeProTier('check-tenant', 'growth', preview2.todayPence, `check-three-${runId}`, fakeSupabase());
      check('upgrade applied', done2.ok && 'applied' in done2);
      const inv = (await stripe.invoices.list({ subscription: subscriptionId, limit: 1 })).data[0];
      console.log(`  latest invoice: £${((inv?.amount_due ?? 0) / 100).toFixed(2)} ${inv?.status}; the dialog said £${(preview2.todayPence / 100).toFixed(2)}`);
      check('the card was charged what the dialog showed', inv?.status === 'paid' && Math.abs(inv.amount_due - preview2.todayPence) <= 2);
      const after2 = await lines();
      check('plan line is Growth and there is no extra line', after2.items.length === 1 && after2.items[0].price === process.env.STRIPE_PRICE_GROWTH);
    }
    await stripe.subscriptions.cancel(sub2.id).catch(() => undefined);
    subscriptionId = firstSubscriptionId;
    teamSize = 20;

    console.log('\nCancel, cancel again, undo');
    const c1 = await cancelProPlan('check-tenant', fakeSupabase());
    check('cancel ok', c1.ok);
    state = await lines();
    check('Stripe says it ends at the period end', state.sub.cancel_at_period_end === true);
    check('cancel again is fine', (await cancelProPlan('check-tenant', fakeSupabase())).ok);
    check('upgrading while ending is refused', !(await previewProUpgrade('check-tenant', 'pro', fakeSupabase())).ok);
    check('undo ok', (await undoProCancel('check-tenant', fakeSupabase())).ok);
    state = await lines();
    check('Stripe says it is no longer ending', state.sub.cancel_at_period_end === false);
  } finally {
    if (keep) console.log(`\nLeft in Stripe test mode: customer ${customer.id}, subscription ${subscriptionId}`);
    else {
      if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId).catch(() => undefined);
      await stripe.customers.del(customer.id).catch(() => undefined);
      console.log('\nCleaned up the test customer and subscription.');
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
