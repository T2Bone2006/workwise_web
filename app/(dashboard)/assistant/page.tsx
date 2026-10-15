import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AssistantPage } from '@/components/assistant/assistant-page';
import { getTenantLook } from '@/lib/data/tenant-look';
import { getTenantProducts } from '@/lib/data/tenant-products';

export const metadata: Metadata = { title: 'Lily' };

export default async function AssistantRoute() {
  const products = await getTenantProducts();
  const noProduct = !products.isPro && !products.hasRounds && !products.hasLite;
  if (noProduct || (products.isPro && (await getTenantLook(products)) !== 'new')) redirect('/dashboard');
  return <AssistantPage />;
}
