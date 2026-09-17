import { redirect } from 'next/navigation';
import { getTenantProducts } from '@/lib/data/tenant-products';

/**
 * Route-level gate for the Pro dispatch pages (jobs, workers, network,
 * monitor, customers, import). Previously the sidebar merely hid these links;
 * typing the URL still worked. Now a tenant without a Pro tier is sent back to
 * its own home.
 */
export default async function ProLayout({ children }: { children: React.ReactNode }) {
  const products = await getTenantProducts();
  if (!products.isPro) {
    redirect('/dashboard');
  }
  return <>{children}</>;
}
