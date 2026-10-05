import { redirect } from 'next/navigation';
import { ReferView } from '@/components/referrals/refer-view';
import { getPlanSummary } from '@/lib/billing/manage';
import { getReferralData } from '@/lib/data/referral-page';
import { shouldShowReferral } from '@/lib/data/referral-nudge';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';

export const metadata = { title: 'Referrals · WorkWise' };

export default async function ReferPage() {
  if (!(await shouldShowReferral())) redirect('/settings?tab=billing');
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) redirect('/settings?tab=billing');

  let plan: 'rounds' | 'lite' | 'both' | null = null;
  try {
    const summary = await getPlanSummary(tenantId);
    if (summary.kind === 'stripe') plan = summary.choice.plan;
  } catch (err) {
    console.error('[refer]', err instanceof Error ? err.name : 'Error');
  }
  if (!plan) redirect('/settings?tab=billing');

  const data = await getReferralData(tenantId, plan);
  if (!data) redirect('/settings?tab=billing');

  return <ReferView {...data} />;
}
