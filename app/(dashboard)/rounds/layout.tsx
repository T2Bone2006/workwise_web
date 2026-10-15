import { redirect } from 'next/navigation';
import { getTenantProducts } from '@/lib/data/tenant-products';

/** Route-level gate for the Rounds area. */
export default async function RoundsLayout({ children }: { children: React.ReactNode }) {
  const products = await getTenantProducts();
  if (!products.hasRounds) {
    redirect('/dashboard');
  }
  return <>{children}</>;
}
