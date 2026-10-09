import { redirect } from 'next/navigation';
import { ProReferView } from '@/components/referrals/pro-refer-view';
import { ReferView } from '@/components/referrals/refer-view';
import { getPlanSummary } from '@/lib/billing/manage';
import { loadProSubscription } from '@/lib/data/worker-allowance';
import { getProReferralData, getReferralData } from '@/lib/data/referral-page';
import { referralKind } from '@/lib/data/referral-nudge';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';

export const metadata = { title: 'Referrals · WorkWise' };

export default async function ReferPage() {
  const kind = await referralKind();
  if (!kind) redirect('/settings?tab=billing');
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) redirect('/settings?tab=billing');

  if (kind === 'pro') {
    let tier: 'starter' | 'growth' | 'pro' | null = null;
    try {
      const row = await loadProSubscription(tenantId);
      if (row && (row.product === 'starter' || row.product === 'growth' || row.product === 'pro')) tier = row.product;
    } catch (err) {
      console.error('[refer]', err instanceof Error ? err.name : 'Error');
    }
    if (!tier) redirect('/settings?tab=billing');
    const proData = await getProReferralData(tenantId, tier);
    if (!proData) redirect('/settings?tab=billing');
    return <ProReferView {...proData} />;
  }

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
