import { redirect } from 'next/navigation';
import { getTenantProducts } from '@/lib/data/tenant-products';

/** Route-level gate for the Lite (chatbot widget) area. */
export default async function LiteLayout({ children }: { children: React.ReactNode }) {
  const products = await getTenantProducts();
  if (!products.hasLite) {
    redirect('/dashboard');
  }
  return <>{children}</>;
}
