import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import type { TenantSettings } from '@/lib/data/settings-types';

/**
 * Product entitlements for the current tenant, read from public.subscriptions.
 *
 * This is the source of truth for what the dashboard shows and which route
 * groups a login may enter. It replaces the old `tenants.settings.features.pro`
 * flag, which had no writer and failed open.
 *
 * Transition rule: while a tenant has *no* subscriptions rows at all (the
 * backfill migration hasn't been run yet), fall back to the legacy flag so an
 * existing Pro tenant can't lose its sidebar. Once every tenant has rows the
 * fallback is dead code and can be removed.
 */

export type Product = 'lite' | 'rounds' | 'starter' | 'growth' | 'pro';

export const PRO_TIER_PRODUCTS: readonly Product[] = ['starter', 'growth', 'pro'];

/** Subscription statuses that grant access. past_due keeps access while Stripe dunning runs. */
export const ENTITLED_STATUSES = ['trialing', 'active', 'past_due', 'manual'] as const;

export type TenantProducts = {
  products: Product[];
  /** Any Pro tier (starter | growth | pro). */
  isPro: boolean;
  hasRounds: boolean;
  hasLite: boolean;
  /** Which product's home the /dashboard page should render. */
  primary: 'pro' | 'rounds' | 'lite' | null;
  /** Earliest trial end across entitled subscriptions, if any is trialing. */
  trialEndsAt: string | null;
  /** Where the answer came from; 'legacy_features' means the backfill hasn't run for this tenant. */
  source: 'subscriptions' | 'legacy_features' | 'none';
};

const NO_PRODUCTS: TenantProducts = {
  products: [],
  isPro: false,
  hasRounds: false,
  hasLite: false,
  primary: null,
  trialEndsAt: null,
  source: 'none',
};

type SubscriptionRow = {
  product: Product;
  status: string;
  trial_ends_at: string | null;
};

function fromProducts(
  products: Product[],
  trialEndsAt: string | null,
  source: TenantProducts['source']
): TenantProducts {
  const isPro = products.some((p) => PRO_TIER_PRODUCTS.includes(p));
  const hasRounds = products.includes('rounds');
  const hasLite = products.includes('lite');
  const primary = isPro ? 'pro' : hasRounds ? 'rounds' : hasLite ? 'lite' : null;
  return { products, isPro, hasRounds, hasLite, primary, trialEndsAt, source };
}

async function legacyProducts(tenantId: string): Promise<TenantProducts> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  const settings = (data?.settings ?? null) as TenantSettings | null;
  // The old default was pro:true when the flag was absent.
  const pro = settings?.features?.pro ?? true;
  return fromProducts(pro ? ['pro'] : [], null, 'legacy_features');
}

/**
 * Resolves the current tenant's products. Memoised per request via React cache()
 * so the layout, sidebar and pages share one query.
 *
 * Fails closed: any error yields no products (the page will redirect to /dashboard,
 * which renders an "account has no products" state rather than Pro pages).
 */
export const getTenantProducts = cache(async (): Promise<TenantProducts> => {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) return NO_PRODUCTS;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('subscriptions')
      .select('product, status, trial_ends_at')
      .eq('tenant_id', tenantId)
      .in('status', [...ENTITLED_STATUSES])
      .returns<SubscriptionRow[]>();

    if (error) {
      // Table missing (migration not yet pasted) or RLS problem: behave like
      // the legacy code so an existing Pro tenant isn't locked out mid-rollout.
      console.warn('[getTenantProducts] subscriptions query failed, using legacy flag:', error.message);
      return legacyProducts(tenantId);
    }

    if (!data || data.length === 0) {
      // Check whether the tenant has *any* rows (e.g. all cancelled) before
      // falling back; a genuinely lapsed tenant must not regain Pro via the flag.
      const { count } = await supabase
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      if ((count ?? 0) > 0) return NO_PRODUCTS;

      const legacy = await legacyProducts(tenantId);
      if (legacy.products.length > 0) {
        console.warn(`[getTenantProducts] tenant ${tenantId} has no subscriptions rows; using legacy features.pro`);
      }
      return legacy;
    }

    const products = Array.from(new Set(data.map((row) => row.product)));
    const trialEndsAt = data
      .filter((row) => row.status === 'trialing' && row.trial_ends_at)
      .map((row) => row.trial_ends_at as string)
      .sort()[0] ?? null;

    return fromProducts(products, trialEndsAt, 'subscriptions');
  } catch (err) {
    console.error('[getTenantProducts] unexpected error:', err);
    return NO_PRODUCTS;
  }
});
