import { redirect } from 'next/navigation';
import { TeamScreen } from '@/components/team/team-screen';
import { requireOwner, NOT_SIGNED_IN } from '@/lib/auth/require-owner';
import { getTeamPageData } from '@/lib/data/team-page';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { todayInLondon } from '@/lib/rounds/dates';

/** The owner's Team page. A Pro business or a member of staff is sent away. */
export default async function TeamPage() {
  const owner = await requireOwner();
  if (!owner.ok) redirect(owner.error === NOT_SIGNED_IN ? '/login' : '/dashboard');

  const products = await getTenantProducts();
  if (!products.hasRounds || products.isPro) redirect('/dashboard');

  const data = await getTeamPageData(owner.tenantId);
  return <TeamScreen data={data} today={todayInLondon()} />;
}
