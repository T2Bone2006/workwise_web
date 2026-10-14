import { redirect } from 'next/navigation';
import { CashScreen } from '@/components/team/cash-screen';
import { requireOwner, NOT_SIGNED_IN } from '@/lib/auth/require-owner';
import { getCashPage } from '@/lib/data/team-cash-page';
import { getTenantProducts } from '@/lib/data/tenant-products';

/** The owner's Cash to hand in page. A Pro business or a member of staff is sent away. */
export default async function TeamCashPage() {
  const owner = await requireOwner();
  if (!owner.ok) redirect(owner.error === NOT_SIGNED_IN ? '/login' : '/dashboard');

  const products = await getTenantProducts();
  if (!products.hasRounds || products.isPro) redirect('/dashboard');

  let data;
  try {
    data = await getCashPage(owner.tenantId);
  } catch (err) {
    console.error('[team/cash]', err instanceof Error ? err.message : 'failed');
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Couldn&apos;t load the cash your team is holding. Refresh to try again.
      </p>
    );
  }
  return <CashScreen data={data} />;
}
