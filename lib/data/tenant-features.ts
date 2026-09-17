import { getTenantProducts, type TenantProducts } from '@/lib/data/tenant-products';

/**
 * Boolean view of the tenant's products, shaped for the sidebar and shell.
 *
 * Derived from public.subscriptions via getTenantProducts(); this file no
 * longer reads tenants.settings.features directly. Kept as a thin wrapper so
 * the DashboardShell / Sidebar prop contract stays stable.
 */
export type TenantFeatures = {
  /** Any Pro tier: starter | growth | pro. */
  pro: boolean;
  rounds: boolean;
  lite: boolean;
  /** Legacy add-on flags: declared, not yet read anywhere. */
  widget: boolean;
  autopilot: boolean;
  voice: boolean;
  payments: boolean;
};

export function featuresFromProducts(products: TenantProducts): TenantFeatures {
  return {
    pro: products.isPro,
    rounds: products.hasRounds,
    lite: products.hasLite,
    widget: products.hasLite,
    autopilot: false,
    voice: false,
    payments: products.hasRounds,
  };
}

export async function getTenantFeatures(): Promise<TenantFeatures> {
  return featuresFromProducts(await getTenantProducts());
}
