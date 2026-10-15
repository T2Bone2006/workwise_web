// Creates the "extra worker" prices in Stripe: one price per Pro tier and billing period
// (Starter £12, Growth £9, Pro £6 a month; a year is ten months' price). Each is added to a business's
// subscription as a second line whose quantity is the number of workers over the plan's allowance.
//
// These amounts mirror PRO_ALLOWANCES in lib/billing/pro-allowance.ts and PRO_TIERS in
// workwise_site/lib/site.ts. Change all three together.
//
//   npm run stripe:extra-worker-prices            (test key: creates the prices)
//   npm run stripe:extra-worker-prices -- --live  (live key: needs the flag)
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
  { tier: 'starter', monthlyPounds: 12, baseEnv: 'STRIPE_PRICE_STARTER' },
  { tier: 'growth', monthlyPounds: 9, baseEnv: 'STRIPE_PRICE_GROWTH' },
  { tier: 'pro', monthlyPounds: 6, baseEnv: 'STRIPE_PRICE_PRO' },
];
const INTERVALS = [
  { interval: 'month', months: 1, keySuffix: 'monthly', envSuffix: '', label: 'monthly' },
  { interval: 'year', months: 10, keySuffix: 'yearly', envSuffix: '_YEARLY', label: 'yearly' },
];
const lookupKey = (tier, keySuffix) => `workwise_extra_worker_${tier}_${keySuffix}`;

const stripe = new Stripe(key);

const existing = await stripe.prices.list({
  lookup_keys: TIERS.flatMap((t) => INTERVALS.map((i) => lookupKey(t.tier, i.keySuffix))),
  active: true,
  limit: 20,
});
const found = new Map(existing.data.map((p) => [p.lookup_key, p]));

// One Stripe product holds every extra-worker price. Reuse it if any price already exists.
let productId = existing.data[0]
  ? typeof existing.data[0].product === 'string'
    ? existing.data[0].product
    : existing.data[0].product.id
  : null;
const table = [];

for (const { tier, monthlyPounds, baseEnv } of TIERS) {
  for (const { interval, months, keySuffix, envSuffix, label } of INTERVALS) {
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
        name: 'WorkWise extra worker',
        description: 'A worker beyond the number included in a Pro plan.',
        metadata: { workwise: 'extra_worker' },
      });
      productId = product.id;
      console.log(`Created product ${productId}`);
    }

    // Match the plan price's tax setting (WorkWise is not VAT registered) so the two lines on one subscription agree.
    let taxBehavior;
    const baseId = process.env[`${baseEnv}${envSuffix}`];
    if (baseId) {
      try {
        const base = await stripe.prices.retrieve(baseId);
        if (base.tax_behavior && base.tax_behavior !== 'unspecified') taxBehavior = base.tax_behavior;
      } catch {
        console.warn(`${tier} ${label}: could not read ${baseEnv}${envSuffix}, leaving the tax setting unspecified`);
      }
    } else {
      console.warn(`${tier} ${label}: ${baseEnv}${envSuffix} is not set, leaving the tax setting unspecified`);
    }

    const price = await stripe.prices.create({
      product: productId,
      currency: 'gbp',
      unit_amount: wanted,
      recurring: { interval },
      nickname: `Extra worker (${tier}, ${label})`,
      lookup_key: lookupKey(tier, keySuffix),
      metadata: { workwise: 'extra_worker', tier, interval },
      ...(taxBehavior ? { tax_behavior: taxBehavior } : {}),
    });
    found.set(lookupKey(tier, keySuffix), price);
    console.log(`${tier} ${label}: created ${price.id} (£${wanted / 100}${taxBehavior ? `, tax ${taxBehavior}` : ''})`);
    table.push([tier, interval, price.unit_amount, price.lookup_key, price.id]);
  }
}

console.log('\ntier    interval  pence     lookup_key                              id');
for (const row of table) console.log(row.map((c, i) => String(c).padEnd([8, 10, 10, 40, 0][i])).join(''));

console.log('\nPaste these into .env.local (and Vercel):\n');
for (const { tier } of TIERS) {
  for (const { keySuffix, envSuffix } of INTERVALS) {
    console.log(`STRIPE_PRICE_EXTRA_WORKER_${tier.toUpperCase()}${envSuffix}=${found.get(lookupKey(tier, keySuffix)).id}`);
  }
}
