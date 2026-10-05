import 'server-only';

import { isBillingInterval, isPlanKey, priceIdFor, type PlanChoice } from '@/lib/billing/plans';
import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import { createClient } from '@/lib/supabase/server';

type SubRow = { source: string | null; product: string | null; status: string | null };

/**
 * Admin of a self-serve business whose plan has ended (no live Stripe subscription).
 * Creates Checkout: mode 'subscription', customer = tenants.stripe_customer_id,
 * line_items [{ price: priceIdFor(choice), quantity: 1 }], allow_promotion_codes: true,
 * NO discounts, metadata { kind: 'restart', tenant_id }, subscription_data.metadata { kind: 'restart', tenant_id, plan, interval },
 * success_url `${appUrl}/dashboard?restarted=1`, cancel_url `${appUrl}/dashboard`.
 * Idempotency key `restart-${tenantId}-${nonce}`.
 */
export async function createRestartCheckout(tenantId: string, choice: PlanChoice, nonce: string): Promise<string> {
  if (!isPlanKey(choice?.plan) || !isBillingInterval(choice?.interval)) {
    throw new Error('bad_choice');
  }
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(nonce)) {
    throw new Error('bad_nonce');
  }

  const supabase = await createClient();
  const [{ data: tenant, error: tenantError }, { data: rows, error: rowsError }] = await Promise.all([
    supabase.from('tenants').select('stripe_customer_id').eq('id', tenantId).maybeSingle(),
    supabase.from('subscriptions').select('source, product, status').eq('tenant_id', tenantId),
  ]);
  if (tenantError || rowsError) {
    console.error('[restart] read_failed');
    throw new Error('read_failed');
  }

  const customerId = typeof tenant?.stripe_customer_id === 'string' ? tenant.stripe_customer_id : '';
  const list = (rows ?? []) as SubRow[];
  const pro = new Set<string>(PRO_TIER_PRODUCTS);
  if (!customerId || list.some((row) => row.source === 'manual' || (row.product != null && pro.has(row.product)))) {
    throw new Error('managed');
  }

  const entitled = new Set<string>(ENTITLED_STATUSES);
  if (list.length === 0 || list.some((row) => row.status != null && entitled.has(row.status))) {
    throw new Error('not_ended');
  }

  const appUrl = getAppUrl();
  const { plan, interval } = choice;
  const session = await getStripe().checkout.sessions.create(
    {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceIdFor(choice), quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { kind: 'restart', tenant_id: tenantId },
      subscription_data: {
        metadata: { kind: 'restart', tenant_id: tenantId, plan, interval },
      },
      success_url: `${appUrl}/dashboard?restarted=1`,
      cancel_url: `${appUrl}/dashboard`,
    },
    { idempotencyKey: `restart-${tenantId}-${nonce}` },
  );
  if (!session.url) throw new Error('no_url');
  return session.url;
}
