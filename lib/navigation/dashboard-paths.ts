import type { TenantProducts } from '@/lib/data/tenant-products';

/**
 * Dashboard paths are product-neutral. Entitlement decides which UI you get,
 * not a `/rounds` or `/pro` prefix in the URL.
 *
 * Shared paths (`/customers`, `/import`): Pro wins when a tenant somehow has
 * both (primary is already Pro). Rounds-only and Lite+Rounds use the Rounds UI.
 * Rounds + Pro together is Phase 8 — until then Pro CRM owns the shared paths.
 */
export function usesRoundsCrm(products: TenantProducts): boolean {
  return products.hasRounds && !products.isPro;
}

export function usesProCrm(products: TenantProducts): boolean {
  return products.isPro;
}

/** Paths used by Rounds surfaces (and shared CRM when Rounds owns them). */
export const paths = {
  customers: '/customers',
  customer: (id: string) => `/customers/${id}`,
  customerNew: '/customers/new',
  customerEdit: (id: string) => `/customers/${id}/edit`,
  agreementNew: (customerId: string, first?: boolean) =>
    first
      ? `/customers/${customerId}/agreements/new?first=1`
      : `/customers/${customerId}/agreements/new`,
  agreementEdit: (customerId: string, agreementId: string) =>
    `/customers/${customerId}/agreements/${agreementId}/edit`,
  calendar: '/calendar',
  services: '/services',
  import: '/import',
  payments: '/payments',
  bank: '/bank',
  messages: '/messages',
  expenses: '/expenses',
} as const;
