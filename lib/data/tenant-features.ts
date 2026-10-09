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
  /** This login has a live link to an employer (a worker area at /worker). */
  worker: boolean;
  /** An employee: no business of their own, so the sidebar is the worker area and nothing else. */
  workerOnly: boolean;
  /** The employer's business name, for the 'Work for …' block. */
  workerEmployer: string | null;
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
    worker: false,
    workerOnly: false,
    workerEmployer: null,
  };
}

/** The sidebar shape for an employee: the worker area and nothing from the office. */
export function employeeFeatures(employerName: string | null): TenantFeatures {
  return {
    pro: false,
    rounds: false,
    lite: false,
    widget: false,
    autopilot: false,
    voice: false,
    payments: false,
    worker: true,
    workerOnly: true,
    workerEmployer: employerName,
  };
}

/** A subcontractor keeps their own business's blocks and gains the 'Work for …' block. */
export function withWorkerBlock(features: TenantFeatures, employerName: string | null): TenantFeatures {
  return { ...features, worker: true, workerOnly: false, workerEmployer: employerName };
}

export async function getTenantFeatures(): Promise<TenantFeatures> {
  return featuresFromProducts(await getTenantProducts());
}
