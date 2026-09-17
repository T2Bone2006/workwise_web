import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import type { Product } from '@/lib/data/tenant-products';

export type BillingSubscription = {
  id: string;
  product: Product;
  status: string;
  source: 'stripe' | 'manual';
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  seats: number;
};

export type BillingSummary = {
  subscriptions: BillingSubscription[];
  /** True when the tenant has a Stripe customer, i.e. the Billing Portal can open. */
  hasStripeCustomer: boolean;
};

export async function getBillingSummary(): Promise<BillingSummary> {
  const empty: BillingSummary = { subscriptions: [], hasStripeCustomer: false };
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return empty;

  const supabase = await createClient();
  const [{ data: rows }, { data: tenant }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('id, product, status, source, trial_ends_at, current_period_end, cancel_at_period_end, seats')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase.from('tenants').select('stripe_customer_id').eq('id', tenantId).maybeSingle(),
  ]);

  return {
    subscriptions: (rows ?? []).map((row) => ({
      id: row.id,
      product: row.product as Product,
      status: row.status,
      source: row.source as 'stripe' | 'manual',
      trialEndsAt: row.trial_ends_at,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      seats: row.seats ?? 1,
    })),
    hasStripeCustomer: Boolean(tenant?.stripe_customer_id),
  };
}
