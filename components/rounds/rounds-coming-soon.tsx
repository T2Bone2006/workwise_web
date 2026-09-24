import { redirect } from 'next/navigation';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

/** Shared gate + empty shell for Rounds surfaces that are not built yet. */
export async function RoundsComingSoon({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const products = await getTenantProducts();
  if (!products.hasRounds) {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-6">
      <PageGradientHeader title={title} subtitle={subtitle} />
      <div className="rounded-xl border border-dashed border-border/80 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">Coming soon in this phase.</p>
      </div>
    </div>
  );
}
