import { redirect } from 'next/navigation';
import { PayScreen } from '@/components/team/pay-screen';
import { requireOwner, NOT_SIGNED_IN } from '@/lib/auth/require-owner';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getTeamPayPage } from '@/lib/data/team-pay-page';
import { parsePayPeriod } from '@/lib/data/team-pay-page-core';

interface PayPageProps {
  searchParams: Promise<{ period?: string; person?: string }>;
}

/** The owner's Pay page. A Pro business or a member of staff is sent away. */
export default async function TeamPayPage({ searchParams }: PayPageProps) {
  const owner = await requireOwner();
  if (!owner.ok) redirect(owner.error === NOT_SIGNED_IN ? '/login' : '/dashboard');

  const products = await getTenantProducts();
  if (!products.hasRounds || products.isPro) redirect('/dashboard');

  const raw = await searchParams;
  const person = typeof raw.person === 'string' && /^[0-9a-f-]{36}$/i.test(raw.person) ? raw.person : null;

  let data;
  try {
    data = await getTeamPayPage(owner.tenantId, parsePayPeriod(raw.period), person);
  } catch (err) {
    console.error('[team/pay]', err instanceof Error ? err.message : 'failed');
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Couldn&apos;t load your team&apos;s pay. Refresh to try again.
      </p>
    );
  }
  return <PayScreen data={data} />;
}
