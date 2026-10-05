import 'server-only';

import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import { choiceForPriceId, isPlanKey, monthlyPence, type PlanKey } from '@/lib/billing/plans';

const STALE_MS = 10 * 60 * 1000;

/** Pure. Amount the trader paid for the plan on this invoice, before customer-balance
 *  credit and after coupon discounts: subtotal − sum(total_discount_amounts). */
export function paidValuePence(invoice: Pick<Stripe.Invoice, 'subtotal' | 'total_discount_amounts'>): number {
  const discounts = invoice.total_discount_amounts ?? [];
  const off = discounts.reduce((sum, row) => sum + row.amount, 0);
  return invoice.subtotal - off;
}

/** Pure. True when the invoice is paid and paidValuePence ≥ monthlyPence(plan). */
export function invoiceQualifies(invoice: Stripe.Invoice, plan: PlanKey): boolean {
  return invoice.status === 'paid' && paidValuePence(invoice) >= monthlyPence(plan);
}

/** For the panel (step 16). Service-role read filtered by referrer_tenant_id = tenantId
 *  (the referred business's name isn't readable through RLS); the caller must already
 *  have checked the signed-in user is an admin of tenantId. Newest first, max 50. */
export type ReferralRow = {
  id: string;
  businessName: string;
  status: 'waiting' | 'rewarding' | 'rewarded' | 'void';
  rewardPence: number | null;
  createdAt: string;
  rewardedAt: string | null;
};

type Outcome =
  | { result: 'no_referral' | 'not_yet' | 'already_handled' }
  | { result: 'void'; reason: 'referrer_no_live_plan' }
  | { result: 'rewarded'; referralId: string; rewardPence: number };

type ReferralRecord = {
  id: string;
  referrer_tenant_id: string;
  referred_tenant_id: string;
  status: string;
  reward_pence: number | null;
  claimed_at: string | null;
};

type SubRow = { source: string | null; product: string | null; status: string | null; plan: string | null };

function logReferral(id: string | null, result: string, err?: unknown) {
  const name = err instanceof Error ? err.name : err ? 'Error' : undefined;
  if (name) console.error('[referrals]', id ?? '-', result, name);
  else console.info('[referrals]', id ?? '-', result);
}

function customerIdOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  if ('deleted' in value && value.deleted === true) return null;
  if ('id' in value && typeof value.id === 'string') return value.id;
  return null;
}

function priceIdOfLine(line: Stripe.InvoiceLineItem): string | null {
  const modern = line.pricing?.price_details?.price;
  if (modern) return typeof modern === 'string' ? modern : modern.id;
  const legacy = (line as { price?: string | { id?: string } | null }).price;
  if (!legacy) return null;
  return typeof legacy === 'string' ? legacy : (legacy.id ?? null);
}

/** Subscription line price on this invoice, preferring the positive (new plan) line. */
function planFromInvoice(invoice: Stripe.Invoice): PlanKey | null {
  let fallback: PlanKey | null = null;
  for (const line of invoice.lines?.data ?? []) {
    const choice = choiceForPriceId(priceIdOfLine(line));
    if (!choice) continue;
    const subscriptionLine = line.parent?.type === 'subscription_item_details' || Boolean(line.subscription);
    if (subscriptionLine && (line.amount ?? 0) > 0) return choice.plan;
    fallback ??= choice.plan;
  }
  return fallback;
}

function planFromRows(rows: SubRow[]): PlanKey | null {
  const entitled = new Set<string>(ENTITLED_STATUSES);
  const live = rows.filter(
    (row) =>
      row.source === 'stripe' &&
      (row.product === 'rounds' || row.product === 'lite') &&
      row.status != null &&
      entitled.has(row.status)
  );
  const plans = live.map((row) => row.plan).filter(isPlanKey);
  if (plans.includes('both')) return 'both';
  if (plans.includes('rounds') && plans.includes('lite')) return 'both';
  if (plans[0]) return plans[0];
  const products = new Set(live.map((row) => row.product));
  if (products.has('rounds') && products.has('lite')) return 'both';
  if (products.has('rounds')) return 'rounds';
  if (products.has('lite')) return 'lite';
  return null;
}

function claimable(row: ReferralRecord, now: number): boolean {
  if (row.status === 'waiting') return true;
  if (row.status !== 'rewarding') return false;
  const claimed = row.claimed_at ? new Date(row.claimed_at).getTime() : 0;
  return now - claimed >= STALE_MS;
}

function claimFilter(cutoffIso: string): string {
  return `status.eq.waiting,and(status.eq.rewarding,claimed_at.lt."${cutoffIso}")`;
}

/** Webhook hook for invoice.paid. Never throws for "nothing to do"; throws only to make Stripe retry. */
export async function onInvoicePaid(invoice: Stripe.Invoice): Promise<Outcome> {
  if (invoice.status !== 'paid') {
    logReferral(null, 'no_referral');
    return { result: 'no_referral' };
  }
  const customerId = customerIdOf(invoice.customer);
  if (!customerId) {
    logReferral(null, 'no_referral');
    return { result: 'no_referral' };
  }

  const admin = createAdminClient();
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, name')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  if (!tenant?.id) {
    logReferral(null, 'no_referral');
    return { result: 'no_referral' };
  }

  const { data: referral, error: referralError } = await admin
    .from('referrals')
    .select('id, referrer_tenant_id, referred_tenant_id, status, reward_pence, claimed_at')
    .eq('referred_tenant_id', tenant.id)
    .maybeSingle();
  if (referralError) throw new Error(referralError.message);
  if (!referral) {
    logReferral(null, 'no_referral');
    return { result: 'no_referral' };
  }
  const row = referral as ReferralRecord;
  if (!claimable(row, Date.now())) {
    logReferral(row.id, 'already_handled');
    return { result: 'already_handled' };
  }

  const fromPrice = planFromInvoice(invoice);
  const plan = fromPrice ?? (await referredPlan(admin, tenant.id));
  if (!plan || !invoiceQualifies(invoice, plan)) {
    logReferral(row.id, 'not_yet');
    return { result: 'not_yet' };
  }

  const referrer = await liveReferrer(admin, row.referrer_tenant_id);
  if (!referrer) {
    const { data: voided, error } = await admin
      .from('referrals')
      .update({ status: 'void', void_reason: 'referrer_no_live_plan' })
      .eq('id', row.id)
      .eq('status', 'waiting')
      .select('id');
    if (error) throw new Error(error.message);
    if (!voided || voided.length === 0) {
      logReferral(row.id, 'already_handled');
      return { result: 'already_handled' };
    }
    logReferral(row.id, 'void');
    return { result: 'void', reason: 'referrer_no_live_plan' };
  }

  const rewardPence = monthlyPence(referrer.plan);
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('referrals')
    .update({
      status: 'rewarding',
      claimed_at: new Date().toISOString(),
      qualifying_invoice_id: invoice.id,
      reward_pence: rewardPence,
    })
    .eq('id', row.id)
    .or(claimFilter(cutoff))
    .select('id');
  if (claimError) throw new Error(claimError.message);
  if (!claimed || claimed.length === 0) {
    logReferral(row.id, 'already_handled');
    return { result: 'already_handled' };
  }

  const businessName = typeof tenant.name === 'string' ? tenant.name : '';
  let txnId: string;
  try {
    txnId = await creditReferrer({
      referralId: row.id,
      customerId: referrer.customerId,
      rewardPence,
      businessName,
    });
  } catch (err) {
    await admin
      .from('referrals')
      .update({ status: 'waiting', claimed_at: null })
      .eq('id', row.id)
      .eq('status', 'rewarding');
    logReferral(row.id, 'waiting', err);
    throw err;
  }

  try {
    await markRewarded(admin, row.id, txnId);
  } catch (err) {
    logReferral(row.id, 'rewarding', err);
    throw err;
  }
  logReferral(row.id, 'rewarded');
  return { result: 'rewarded', referralId: row.id, rewardPence };
}

/** Webhook hook for customer.subscription.deleted: the referred trader left before qualifying. */
export async function onSubscriptionEnded(subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(subscription.customer);
  if (!customerId) return;
  const admin = createAdminClient();
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  if (!tenant?.id) return;
  const { data, error } = await admin
    .from('referrals')
    .update({ status: 'void', void_reason: 'referee_left' })
    .eq('referred_tenant_id', tenant.id)
    .eq('status', 'waiting')
    .select('id');
  if (error) throw new Error(error.message);
  for (const row of data ?? []) logReferral(row.id, 'void');
}

/** Daily: retries rewards stuck in 'rewarding' for over 10 minutes (same idempotency key). */
export async function sweepStuckReferralRewards(): Promise<{ retried: number; rewarded: number; failed: number }> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data, error } = await admin
    .from('referrals')
    .select('id, reward_pence, referrer_tenant_id, referred_tenant_id')
    .eq('status', 'rewarding')
    .lt('claimed_at', cutoff);
  if (error) throw new Error(error.message);

  let retried = 0;
  let rewarded = 0;
  let failed = 0;
  for (const row of data ?? []) {
    retried += 1;
    if (typeof row.reward_pence !== 'number') {
      failed += 1;
      logReferral(row.id, 'failed');
      continue;
    }
    try {
      const customerId = await stripeCustomerId(admin, row.referrer_tenant_id);
      if (!customerId) throw new Error('Missing customer');
      const businessName = await businessNameOf(admin, row.referred_tenant_id);
      const txnId = await creditReferrer({
        referralId: row.id,
        customerId,
        rewardPence: row.reward_pence,
        businessName,
      });
      await markRewarded(admin, row.id, txnId);
      rewarded += 1;
      logReferral(row.id, 'rewarded');
    } catch (err) {
      failed += 1;
      logReferral(row.id, 'failed', err);
    }
  }
  return { retried, rewarded, failed };
}

export async function listMyReferrals(tenantId: string): Promise<ReferralRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('referrals')
    .select('id, status, reward_pence, created_at, rewarded_at, referred_tenant_id')
    .eq('referrer_tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((row) => row.referred_tenant_id).filter((id): id is string => typeof id === 'string'))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: tenants, error: nameError } = await admin.from('tenants').select('id, name').in('id', ids);
    if (nameError) throw new Error(nameError.message);
    for (const tenant of tenants ?? []) {
      if (typeof tenant.id === 'string') names.set(tenant.id, typeof tenant.name === 'string' ? tenant.name : '');
    }
  }
  const out: ReferralRow[] = [];
  for (const row of rows) {
    const status = asStatus(row.status);
    if (!status || typeof row.id !== 'string' || typeof row.created_at !== 'string') continue;
    out.push({
      id: row.id,
      businessName: names.get(row.referred_tenant_id) ?? '',
      status,
      rewardPence: typeof row.reward_pence === 'number' ? row.reward_pence : null,
      createdAt: row.created_at,
      rewardedAt: typeof row.rewarded_at === 'string' ? row.rewarded_at : null,
    });
  }
  return out;
}

function asStatus(value: unknown): ReferralRow['status'] | null {
  if (value === 'waiting' || value === 'rewarding' || value === 'rewarded' || value === 'void') return value;
  return null;
}

type Admin = ReturnType<typeof createAdminClient>;

async function referredPlan(admin: Admin, tenantId: string): Promise<PlanKey | null> {
  const { data, error } = await admin.from('subscriptions').select('plan, product, source, status').eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);
  return planFromRows((data ?? []) as SubRow[]);
}

async function liveReferrer(admin: Admin, tenantId: string): Promise<{ customerId: string; plan: PlanKey } | null> {
  const { data: tenant, error } = await admin
    .from('tenants')
    .select('id, closed_at, stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!tenant || tenant.closed_at || !tenant.stripe_customer_id) return null;
  const { data: subs, error: subError } = await admin
    .from('subscriptions')
    .select('plan, product, source, status')
    .eq('tenant_id', tenantId);
  if (subError) throw new Error(subError.message);
  const rows = (subs ?? []) as SubRow[];
  const pro = new Set<string>(PRO_TIER_PRODUCTS);
  if (rows.some((row) => row.source === 'manual' || (row.product != null && pro.has(row.product)))) return null;
  const plan = planFromRows(rows);
  if (!plan) return null;
  return { customerId: tenant.stripe_customer_id, plan };
}

async function stripeCustomerId(admin: Admin, tenantId: string): Promise<string | null> {
  const { data, error } = await admin.from('tenants').select('stripe_customer_id').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.stripe_customer_id === 'string' ? data.stripe_customer_id : null;
}

async function businessNameOf(admin: Admin, tenantId: string): Promise<string> {
  const { data, error } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.name === 'string' ? data.name : '';
}

/** Stripe drops idempotency keys after 24 hours, so a later sweep must find the credit itself. */
async function existingReferralCredit(customerId: string, referralId: string): Promise<string | null> {
  const stripe = getStripe();
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const listed = await stripe.customers.listBalanceTransactions(customerId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const txn of listed.data) {
      if (txn.metadata?.referral_id === referralId) return txn.id;
    }
    if (!listed.has_more) return null;
    const last = listed.data[listed.data.length - 1];
    if (!last) throw new Error('Referral credit lookup incomplete');
    startingAfter = last.id;
  }
  throw new Error('Referral credit lookup incomplete');
}

async function creditReferrer(input: {
  referralId: string;
  customerId: string;
  rewardPence: number;
  businessName: string;
}): Promise<string> {
  const existing = await existingReferralCredit(input.customerId, input.referralId);
  if (existing) return existing;
  const txn = await getStripe().customers.createBalanceTransaction(
    input.customerId,
    {
      amount: -input.rewardPence,
      currency: 'gbp',
      description: `Free month for referring ${input.businessName}`,
      metadata: { referral_id: input.referralId },
    },
    { idempotencyKey: `referral-reward-${input.referralId}` }
  );
  return txn.id;
}

async function markRewarded(admin: Admin, referralId: string, txnId: string): Promise<void> {
  const { data, error } = await admin
    .from('referrals')
    .update({
      status: 'rewarded',
      stripe_balance_transaction_id: txnId,
      rewarded_at: new Date().toISOString(),
    })
    .eq('id', referralId)
    .eq('status', 'rewarding')
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Referral reward was not recorded');
}
