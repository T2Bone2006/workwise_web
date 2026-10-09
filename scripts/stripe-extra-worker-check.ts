/**
 * End-to-end check of the extra-worker billing against Stripe TEST mode.
 *
 * Creates a throwaway test customer with a test card and a Starter subscription, then runs the real
 * reconcileExtraWorkers() while pretending the team has 10, 12, 13, 11 and 10 workers, and reads the
 * subscription back from Stripe after each step. The database is faked (we only change what it reports),
 * so nothing in Supabase is read or written. Everything created in Stripe is removed at the end
 * (pass --keep to leave it for inspection in the dashboard).
 *
 *   npm run stripe:extra-worker-check              (a monthly Starter subscription)
 *   npm run stripe:extra-worker-check -- --yearly  (a yearly Starter subscription: each change is charged or
 *                                                   credited at once; prints each immediate invoice and the final balance)
 *
 * Needs STRIPE_SECRET_KEY (a test key), STRIPE_PRICE_STARTER[_YEARLY] and STRIPE_PRICE_EXTRA_WORKER_STARTER[_YEARLY].
 */
import Stripe from 'stripe';
import { reconcileExtraWorkers } from '../lib/billing/extra-workers';
import { previewExtraWorkerCharge } from '../lib/billing/extra-workers-preview';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.error('This check runs in TEST mode only.');
  process.exit(1);
}
const yearly = process.argv.includes('--yearly');
const suffix = yearly ? '_YEARLY' : '';
const starterPrice = process.env[`STRIPE_PRICE_STARTER${suffix}`];
const extraStarterPrice = process.env[`STRIPE_PRICE_EXTRA_WORKER_STARTER${suffix}`];
if (!starterPrice || !extraStarterPrice) {
  console.error(`STRIPE_PRICE_STARTER${suffix} and STRIPE_PRICE_EXTRA_WORKER_STARTER${suffix} must be set.`);
  process.exit(1);
}

const stripe = new Stripe(key, { appInfo: { name: 'WorkWise check', url: 'https://joinworkwise.com' } });
const keep = process.argv.includes('--keep');

let teamSize = 10;
let subscriptionId = '';

/** Stands in for Supabase: one live Starter subscription row, and a worker count we control. */
function fakeSupabase() {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'neq', 'not']) b[m] = () => b;
    b.returns = () =>
      Promise.resolve({
        data:
          table === 'subscriptions'
            ? [
                {
                  product: 'starter',
                  source: 'stripe',
                  status: 'active',
                  stripe_subscription_id: subscriptionId,
                  included_workers_override: null,
                },
              ]
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

async function lines(): Promise<Array<{ price: string; quantity: number }>> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return sub.items.data.map((i) => ({ price: i.price.id, quantity: i.quantity ?? 0 }));
}

async function step(workers: number, expect: { outcome: string; extraQuantity: number | null }) {
  const before = teamSize;
  // Yearly: what the dialog would show for this change, asked of Stripe before the change is made.
  const preview =
    yearly && workers > before ? await previewExtraWorkerCharge('check-tenant', workers - before, fakeSupabase()) : null;
  teamSize = workers;
  console.log(`\nTeam of ${workers} (Starter includes 10)`);
  const result = await reconcileExtraWorkers('check-tenant', fakeSupabase());
  console.log(`  outcome: ${JSON.stringify(result)}`);
  check(`outcome is "${expect.outcome}"`, result.outcome === expect.outcome);

  const now = await lines();
  const plan = now.find((l) => l.price === starterPrice);
  const extra = now.find((l) => l.price === extraStarterPrice);
  console.log(`  subscription lines: ${now.map((l) => `${l.price.slice(-6)}×${l.quantity}`).join(', ')}`);
  check('plan line untouched (Starter × 1)', plan?.quantity === 1);
  check(
    expect.extraQuantity === null ? 'no extra-worker line' : `extra-worker line × ${expect.extraQuantity}`,
    (extra?.quantity ?? null) === expect.extraQuantity,
  );

  if (yearly) {
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, limit: 2 });
    const latest = invoices.data[0];
    if (latest) {
      console.log(`  latest invoice: £${(latest.amount_due / 100).toFixed(2)} ${latest.status} (${latest.billing_reason})`);
    }
    if (preview && preview.ok && preview.chargeNowPence !== null && latest) {
      const diff = Math.abs(latest.amount_due - preview.chargeNowPence);
      console.log(`  the dialog would have said: £${(preview.chargeNowPence / 100).toFixed(2)} now`);
      check('the figure the dialog shows equals what Stripe charged', diff <= 2, `preview ${preview.chargeNowPence}, invoice ${latest.amount_due}`);
    }
  }

  try {
    const preview = await stripe.invoices.createPreview({ subscription: subscriptionId });
    const prorations = preview.lines.data
      .filter((l) => /remaining|unused|extra/i.test(l.description ?? ''))
      .map((l) => `${l.description}: £${(l.amount / 100).toFixed(2)}`);
    console.log(`  next invoice preview: £${(preview.amount_due / 100).toFixed(2)}${prorations.length ? ` (${prorations.join('; ')})` : ''}`);
  } catch (err) {
    console.log(`  (invoice preview not available: ${err instanceof Error ? err.message : err})`);
  }
}

async function main() {
  const customer = await stripe.customers.create({
    name: 'WorkWise extra-worker check (safe to delete)',
    email: 'extra-worker-check@example.com',
    metadata: { workwise_check: 'extra-workers' },
  });
  let ok = false;
  try {
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: starterPrice }],
      metadata: { workwise_check: 'extra-workers' },
    });
    subscriptionId = sub.id;
    console.log(`Test customer ${customer.id}, subscription ${sub.id} (status ${sub.status})`);

    await step(10, { outcome: 'unchanged', extraQuantity: null });
    await step(12, { outcome: 'added', extraQuantity: 2 });
    await step(12, { outcome: 'unchanged', extraQuantity: 2 });
    await step(13, { outcome: 'updated', extraQuantity: 3 });
    await step(11, { outcome: 'updated', extraQuantity: 1 });
    await step(10, { outcome: 'removed', extraQuantity: null });
    if (yearly) {
      const after = await stripe.customers.retrieve(customer.id);
      const balance = 'balance' in after ? after.balance : 0;
      console.log(`\nCustomer balance after the changes: £${(balance / 100).toFixed(2)} (negative = credit)`);
      check('removing workers left a credit on the account', balance < 0, `balance ${balance}`);
    }
    ok = true;
  } finally {
    if (keep) {
      console.log(`\nLeft in Stripe test mode: customer ${customer.id}, subscription ${subscriptionId}`);
    } else {
      if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId).catch(() => undefined);
      await stripe.customers.del(customer.id).catch(() => undefined);
      console.log('\nCleaned up the test customer and subscription.');
    }
  }
  if (!ok || failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
