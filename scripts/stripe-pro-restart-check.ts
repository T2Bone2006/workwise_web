/**
 * Check of the Pro restart Checkout against Stripe TEST mode.
 *
 * Creates a throwaway test customer, runs the real createProRestartCheckout (database faked: it reports an ended
 * Starter plan and a team of 13), reads the Checkout session back from Stripe and checks the lines, the total and
 * that no discount or promo box is on it. Everything created is removed at the end.
 *
 *   npm run stripe:pro-restart-check
 */
import Stripe from 'stripe';
import { createProRestartCheckout } from '../lib/billing/pro-restart';

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.error('This check runs in TEST mode only.');
  process.exit(1);
}
const stripe = new Stripe(key, { appInfo: { name: 'WorkWise check', url: 'https://joinworkwise.com' } });
const runId = Date.now();
let customerId = '';
let teamSize = 13;
let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

function fakeSupabase(interval: string) {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'order']) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: table === 'tenants' ? { stripe_customer_id: customerId } : null, error: null });
    b.then = (resolve: (v: unknown) => void) =>
      resolve(
        table === 'subscriptions'
          ? { data: [{ source: 'stripe', product: 'starter', status: 'canceled', billing_interval: interval }], error: null }
          : { count: teamSize, error: null },
      );
    return b;
  };
  return { from: (table: string) => builder(table) } as never;
}

async function run(interval: 'month' | 'year', team: number, expectPence: number, expectExtras: number) {
  teamSize = team;
  console.log(`\n${interval}ly Starter, team of ${team}`);
  const url = await createProRestartCheckout('tenant-check', { tier: 'starter', interval }, `check-${runId}-${interval}-${team}`, fakeSupabase(interval));
  check('Checkout URL returned', url.startsWith('https://checkout.stripe.com/'));
  const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 10 });
  const session = sessions.data.find((s) => s.url === url) ?? sessions.data[0];
  const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
  const items = full.line_items?.data ?? [];
  check('plan line, quantity 1', items[0]?.quantity === 1);
  check(`extras quantity ${expectExtras}`, (items[1]?.quantity ?? 0) === expectExtras, `${items.length} lines`);
  check(`total ${expectPence / 100}`, full.amount_total === expectPence, String(full.amount_total));
  check('no promotion-code box', full.allow_promotion_codes === false);
  check('no discounts', (full.total_details?.amount_discount ?? 0) === 0);
  check('restart metadata', full.metadata?.kind === 'restart' && full.subscription !== undefined);
  await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
}

async function main() {
  const customer = await stripe.customers.create({ email: `restart-check-${runId}@example.com`, name: 'Restart check (delete me)' });
  customerId = customer.id;
  try {
    await run('month', 13, 14900 + 3 * 1200, 3);
    await run('year', 13, 149000 + 3 * 12000, 3);
    await run('month', 4, 14900, 0);
  } finally {
    await stripe.customers.del(customerId).catch(() => undefined);
  }
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  if (customerId) void stripe.customers.del(customerId).catch(() => undefined);
  process.exit(1);
});
