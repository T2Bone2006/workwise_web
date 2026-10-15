import 'server-only';

import { isBillingInterval } from '@/lib/billing/plans';
import { extraWorkerPriceIdFor, proPlanPriceId } from '@/lib/billing/pro-plan-prices';
import { endedProChoice, proRestartLines } from '@/lib/billing/pro-restart-core';
import { PRO_PLANS, formatPoundsLong, isProTier, proPriceLabel, type ProChoice } from '@/lib/billing/pro-plans';
import { countTeamWorkers } from '@/lib/data/workers';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = { source: string | null; product: string | null; status: string | null; billing_interval?: string | null };

async function readAccount(tenantId: string, client?: SupabaseClient): Promise<{ customerId: string; rows: Row[] }> {
  const supabase = client ?? (await createClient());
  const [{ data: tenant, error: tenantError }, { data: rows, error: rowsError }] = await Promise.all([
    supabase.from('tenants').select('stripe_customer_id').eq('id', tenantId).maybeSingle(),
    supabase
      .from('subscriptions')
      .select('source, product, status, billing_interval, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ]);
  if (tenantError || rowsError) {
    console.error('[proRestart] read_failed');
    throw new Error('read_failed');
  }
  const customerId = typeof tenant?.stripe_customer_id === 'string' ? tenant.stripe_customer_id : '';
  return { customerId, rows: (rows ?? []) as Row[] };
}

/**
 * The tier and interval of the business's most recent ended Stripe-billed Pro plan, or null for: no rows, manual
 * rows, no Stripe customer, a live subscription (nothing to restart), or a Rounds/Lite-only history.
 */
export async function proRestartChoice(tenantId: string): Promise<ProChoice | null> {
  try {
    const { customerId, rows } = await readAccount(tenantId);
    return endedProChoice(rows, Boolean(customerId));
  } catch (err) {
    console.error('[proRestartChoice]', err instanceof Error ? err.name : 'Error');
    return null;
  }
}

/**
 * Checkout for the existing Stripe customer: the plan, plus the extra-worker line when the team they have today
 * is over the allowance, so the owner agrees to the real total up front. No discount of any kind and no promo box
 * (D3). Idempotency key `pro-restart-${tenantId}-${nonce}` so a double click makes one Checkout.
 * Throws 'managed' | 'bad_choice' | 'bad_nonce' | 'read_failed' | 'missing_price' | 'no_url'.
 */
export async function createProRestartCheckout(
  tenantId: string,
  choice: ProChoice,
  nonce: string,
  /** Only the check script passes this (no signed-in user there). */
  client?: SupabaseClient,
): Promise<string> {
  if (!isProTier(choice?.tier) || !isBillingInterval(choice?.interval)) throw new Error('bad_choice');
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(nonce)) throw new Error('bad_nonce');

  const { customerId, rows } = await readAccount(tenantId, client);
  // Manual accounts, no Stripe customer, a live subscription (a restart finished in another tab) or no ended Pro
  // plan to restart: this page isn't theirs.
  if (!endedProChoice(rows, Boolean(customerId))) throw new Error('managed');

  const team = await countTeamWorkers(tenantId, { includePending: true }, client);
  if (team === null) throw new Error('read_failed');

  // Read every price id before creating anything: a missing one must not end in a plan-only Checkout.
  const plan = PRO_PLANS[choice.tier];
  let planPriceId: string;
  try {
    planPriceId = proPlanPriceId(choice);
  } catch {
    throw new Error('missing_price');
  }
  const extraPriceId = extraWorkerPriceIdFor(choice.tier, choice.interval);
  if (team > plan.included && !extraPriceId) throw new Error('missing_price');

  const lines = proRestartLines({ planPriceId, extraPriceId, teamSize: team, included: plan.included });
  const over = lines[1]?.quantity ?? 0;
  const per = choice.interval === 'month' ? 'a month' : 'a year';
  const appUrl = getAppUrl();
  const session = await getStripe().checkout.sessions.create(
    {
      mode: 'subscription',
      customer: customerId,
      line_items: lines,
      allow_promotion_codes: false,
      payment_method_collection: 'always',
      metadata: { kind: 'restart', tenant_id: tenantId },
      subscription_data: {
        metadata: { kind: 'restart', tenant_id: tenantId, tier: choice.tier, interval: choice.interval },
      },
      success_url: `${appUrl}/dashboard?restarted=1`,
      cancel_url: `${appUrl}/dashboard`,
      custom_text: {
        submit: {
          message:
            over > 0
              ? `${plan.name}: ${proPriceLabel(choice)}, plus ${over} extra ${over === 1 ? 'worker' : 'workers'} at ${formatPoundsLong(plan.extraPence[choice.interval])} each ${per}. Cancel any time.`
              : `${plan.name}: ${proPriceLabel(choice)}. Cancel any time.`,
        },
      },
    },
    { idempotencyKey: `pro-restart-${tenantId}-${nonce}` },
  );
  if (!session.url) throw new Error('no_url');
  return session.url;
}
