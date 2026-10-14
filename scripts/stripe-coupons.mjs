// Makes the five discount coupons in Stripe, each LIMITED to the three plan products
// (WorkWise Rounds, WorkWise Lite, WorkWise Rounds + Lite), so the £10 Rounds team line is never
// halved or free (Phase 9 D15). Stripe cannot edit a coupon's product limit afterwards, so a coupon that
// exists without the limit is deleted and made again with the same ID and settings.
//
//   npm run stripe:coupons                     (test key: only shows what it WOULD do)
//   npm run stripe:coupons -- --apply          (test key: does it)
//   npm run stripe:coupons -- --apply --live   (live key: needs both flags)
//
// The plan products are found from the plan prices in .env.local (STRIPE_PRICE_ROUNDS, _LITE, _BOTH and
// their _YEARLY twins), so no product ids are typed in. The team product is never allowed in the list.
//
// These definitions mirror lib/billing/offers.ts and docs/specs/phase-7/00-context.md (D3, D4).
// Safe to run twice: a coupon that is already right is left alone.
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
const apply = process.argv.includes('--apply');
if (mode === 'live' && !process.argv.includes('--live')) {
  console.error('This is a LIVE key. Re-run with --live (and --apply) if you really mean to change live coupons.');
  process.exit(1);
}
console.log(apply ? 'Mode: APPLY (changes Stripe)\n' : 'Mode: dry run (changes nothing; add --apply to do it)\n');

const stripe = new Stripe(key);

const PLAN_PRICE_ENVS = [
  'STRIPE_PRICE_ROUNDS',
  'STRIPE_PRICE_LITE',
  'STRIPE_PRICE_BOTH',
  'STRIPE_PRICE_ROUNDS_YEARLY',
  'STRIPE_PRICE_LITE_YEARLY',
  'STRIPE_PRICE_BOTH_YEARLY',
];
const TEAM_PRICE_ENVS = ['STRIPE_PRICE_ROUNDS_TEAM_MONTHLY', 'STRIPE_PRICE_ROUNDS_TEAM_YEARLY'];

const COUPONS = [
  { id: 'FOUNDING50', name: 'Founding offer', percent_off: 50, duration: 'repeating', duration_in_months: 2, max_redemptions: 200 },
  { id: 'REFERRAL_MONTH', name: 'Referral: first month free', percent_off: 100, duration: 'once' },
  { id: 'REFERRAL_SECOND_HALF', name: 'Second month half price', percent_off: 50, duration: 'once' },
  { id: 'REFERRAL_YEAR_35', name: 'Referral: £35 off your first year', amount_off: 3500, currency: 'gbp', duration: 'once' },
  { id: 'REFERRAL_YEAR_59', name: 'Referral: £59 off your first year', amount_off: 5900, currency: 'gbp', duration: 'once' },
];

async function productOfPrice(envName) {
  const id = process.env[envName];
  if (!id) return null;
  const price = await stripe.prices.retrieve(id);
  return typeof price.product === 'string' ? price.product : price.product.id;
}

const planProducts = new Set();
const missingEnv = [];
for (const name of PLAN_PRICE_ENVS) {
  const product = await productOfPrice(name);
  if (product) planProducts.add(product);
  else missingEnv.push(name);
}
if (missingEnv.length === PLAN_PRICE_ENVS.length) {
  console.error('None of the plan price ids are in the environment. Is .env.local filled in?');
  process.exit(1);
}
for (const name of TEAM_PRICE_ENVS) {
  const product = await productOfPrice(name);
  if (product && planProducts.has(product)) {
    console.error(`Refusing to run: ${name} lives on a plan product, so a plan-only limit would include the team line.`);
    process.exit(1);
  }
}
if (planProducts.size !== 3) {
  console.error(`Expected 3 plan products (Rounds, Lite, Rounds + Lite) but found ${planProducts.size}. Missing: ${missingEnv.join(', ') || 'none'}`);
  process.exit(1);
}
const wantedProducts = [...planProducts].sort();
console.log(`Plan products: ${wantedProducts.join(', ')}\n`);

const sameProducts = (coupon) => {
  const have = [...(coupon.applies_to?.products ?? [])].sort();
  return have.length === wantedProducts.length && have.every((p, i) => p === wantedProducts[i]);
};
const sameTerms = (coupon, want) =>
  coupon.percent_off === (want.percent_off ?? null) &&
  coupon.amount_off === (want.amount_off ?? null) &&
  coupon.duration === want.duration &&
  (coupon.duration_in_months ?? null) === (want.duration_in_months ?? null) &&
  (coupon.max_redemptions ?? null) === (want.max_redemptions ?? null);

function createParams(want) {
  const { id, name, percent_off, amount_off, currency, duration, duration_in_months, max_redemptions } = want;
  return {
    id,
    name,
    duration,
    ...(percent_off != null ? { percent_off } : {}),
    ...(amount_off != null ? { amount_off, currency } : {}),
    ...(duration_in_months != null ? { duration_in_months } : {}),
    ...(max_redemptions != null ? { max_redemptions } : {}),
    applies_to: { products: wantedProducts },
  };
}

let problems = 0;
for (const want of COUPONS) {
  let have = null;
  try {
    // Stripe leaves applies_to out of a coupon unless it is asked for.
    have = await stripe.coupons.retrieve(want.id, { expand: ['applies_to'] });
  } catch (e) {
    if (e?.code !== 'resource_missing') throw e;
  }

  if (!have) {
    console.log(`${want.id}: missing -> create (limited to the plan products)`);
  } else if (sameProducts(have) && sameTerms(have, want)) {
    console.log(`${want.id}: already right, left alone (${have.times_redeemed} used)`);
    continue;
  } else if (sameProducts(have)) {
    console.log(`${want.id}: limited correctly but its terms differ from the plan (percent/amount/duration/limit). Left alone; check it by hand.`);
    problems += 1;
    continue;
  } else {
    if (mode === 'live' && have.times_redeemed > 0) {
      console.log(`${want.id}: NOT limited to the plan products and already used ${have.times_redeemed} time(s) in live. Not deleting it (that would reset its count). Decide with Claude.`);
      problems += 1;
      continue;
    }
    console.log(`${want.id}: not limited to the plan products -> delete and create again (${have.times_redeemed} used so far)`);
  }

  if (!apply) continue;
  if (have) await stripe.coupons.del(want.id);
  await stripe.coupons.create(createParams(want));
  const made = await stripe.coupons.retrieve(want.id, { expand: ['applies_to'] });
  const ok = sameProducts(made) && sameTerms(made, want);
  console.log(`   created ${made.id}: limited to ${made.applies_to?.products?.length ?? 0} products ${ok ? '(verified)' : '(WARNING: does not match, check it)'}`);
  if (!ok) problems += 1;
}

console.log('');
const envLines = {
  STRIPE_COUPON_FOUNDING: 'FOUNDING50',
  STRIPE_COUPON_REFERRAL_MONTH: 'REFERRAL_MONTH',
  STRIPE_COUPON_REFERRAL_SECOND_HALF: 'REFERRAL_SECOND_HALF',
  STRIPE_COUPON_REFERRAL_YEAR_35: 'REFERRAL_YEAR_35',
  STRIPE_COUPON_REFERRAL_YEAR_59: 'REFERRAL_YEAR_59',
};
for (const [name, id] of Object.entries(envLines)) {
  const set = process.env[name];
  console.log(set === id ? `${name} = ${id}  (ok)` : `${name} is "${set ?? ''}" but should be ${id}`);
}
if (!apply) console.log('\nThat was a dry run. Nothing changed.');
if (problems) process.exit(2);
