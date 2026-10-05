import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFoundingStatus } from '@/lib/billing/offers';
import { monthlyPence, type PlanKey } from '@/lib/billing/plans';
import { listMyReferrals, type ReferralRow } from '@/lib/billing/referrals';
import { getAppUrl } from '@/lib/stripe/client';

export type ReferralData = {
  link: string;
  code: string;
  referrals: ReferralRow[];
  /** null = unknown (treated as active, same as the sign-up page) */
  foundingActive: boolean | null;
  /** What one free month is worth to this trader: their own plan's monthly price. */
  myMonthlyPence: number;
};

/** The link, code and list for one business. No code or a failed read returns null. */
export async function getReferralData(tenantId: string, plan: PlanKey): Promise<ReferralData | null> {
  try {
    const { data, error } = await createAdminClient()
      .from('tenants')
      .select('referral_code')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) throw new Error('referral code');
    const code = typeof data?.referral_code === 'string' ? data.referral_code : '';
    if (!code) return null;
    const [referrals, founding] = await Promise.all([listMyReferrals(tenantId), getFoundingStatus()]);
    return {
      link: `${getAppUrl()}/r/${code}`,
      code,
      referrals,
      foundingActive: founding.active,
      myMonthlyPence: monthlyPence(plan),
    };
  } catch (err) {
    console.error('[referrals]', err instanceof Error ? err.name : 'Error');
    return null;
  }
}
