// Creates the Pro plan prices in Stripe: one price per tier and billing period
// (Starter £149, Growth £449, Pro £749 a month; a year is ten months' price). Each business on a Pro
// tier has one of these as its plan line; the "extra worker" line
// (scripts/stripe-extra-worker-prices.mjs) sits beside it.
//
// These amounts mirror PRO_TIERS in workwise_site/lib/site.ts and PRO_ALLOWANCES in
// lib/billing/pro-allowance.ts. Change all three together.
// WorkWise is not VAT registered, so these are the prices customers pay; the tax setting is left unspecified and
// can be set once on each price when that changes.
//
//   npm run stripe:pro-prices            (test key: creates the prices)
//   npm run stripe:pro-prices -- --live  (live key: needs the flag)
//
// Safe to run twice: prices are found by lookup_key and never duplicated.
// Prints the env lines to paste into .env.local (and Vercel).
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}

const mode = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unknown';
console.log(`Stripe key: ${mode}`);
if (mode === 'unknown') {
  console.error('Refusing to run: the key is neither sk_test_ nor sk_live_.');
  process.exit(1);
}
if (mode === 'live' && !process.argv.includes('--live')) {
  console.error('This is a LIVE key. Re-run with --live if you really mean to create live prices.');
  process.exit(1);
}

const TIERS = [
  { tier: 'starter', name: 'WorkWise Starter', monthlyPounds: 149, included: 10 },
  { tier: 'growth', name: 'WorkWise Growth', monthlyPounds: 449, included: 35 },
  { tier: 'pro', name: 'WorkWise Pro', monthlyPounds: 749, included: 70 },
];
const INTERVALS = [
  { interval: 'month', months: 1, keySuffix: 'monthly', envSuffix: '', label: 'monthly' },
  { interval: 'year', months: 10, keySuffix: 'yearly', envSuffix: '_YEARLY', label: 'yearly' },
];
const lookupKey = (tier, keySuffix) => `workwise_pro_${tier}_${keySuffix}`;

const stripe = new Stripe(key);

const existing = await stripe.prices.list({
  lookup_keys: TIERS.flatMap((t) => INTERVALS.map((i) => lookupKey(t.tier, i.keySuffix))),
  active: true,
  limit: 20,
});
const found = new Map(existing.data.map((p) => [p.lookup_key, p]));
const table = [];

for (const { tier, name, monthlyPounds, included } of TIERS) {
  // One product per tier, shared by its monthly and yearly price.
  const sibling = INTERVALS.map((i) => found.get(lookupKey(tier, i.keySuffix))).find(Boolean);
  let productId = sibling ? (typeof sibling.product === 'string' ? sibling.product : sibling.product.id) : null;

  for (const { interval, months, keySuffix, label } of INTERVALS) {
    const wanted = monthlyPounds * months * 100;
    const have = found.get(lookupKey(tier, keySuffix));
    if (have) {
      const ok = have.unit_amount === wanted && have.currency === 'gbp';
      console.log(
        `${tier} ${label}: already exists (${have.id})${ok ? '' : `  WARNING: amount is ${have.unit_amount} ${have.currency}, expected ${wanted} gbp`}`,
      );
      table.push([tier, interval, have.unit_amount, have.lookup_key, have.id]);
      continue;
    }

    if (!productId) {
      const product = await stripe.products.create({
        name,
        description: `${name}: ${included} workers included, then billed per extra worker.`,
        metadata: { workwise: 'pro_plan', tier },
      });
      productId = product.id;
    }
    const price = await stripe.prices.create({
      product: productId,
      currency: 'gbp',
      unit_amount: wanted,
      recurring: { interval },
      nickname: `${name} (${label})`,
      lookup_key: lookupKey(tier, keySuffix),
      metadata: { workwise: 'pro_plan', tier, interval, included_workers: String(included) },
    });
    found.set(lookupKey(tier, keySuffix), price);
    console.log(`${tier} ${label}: created ${price.id} (£${wanted / 100})`);
    table.push([tier, interval, price.unit_amount, price.lookup_key, price.id]);
  }
}

console.log('\ntier    interval  pence     lookup_key                      id');
for (const row of table) console.log(row.map((c, i) => String(c).padEnd([8, 10, 10, 32, 0][i])).join(''));

console.log('\nPaste these into .env.local (and Vercel):\n');
for (const { tier } of TIERS) {
  for (const { keySuffix, envSuffix } of INTERVALS) {
    console.log(`STRIPE_PRICE_${tier.toUpperCase()}${envSuffix}=${found.get(lookupKey(tier, keySuffix)).id}`);
  }
}
