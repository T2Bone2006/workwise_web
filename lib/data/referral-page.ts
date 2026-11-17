import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFoundingStatus } from '@/lib/billing/offers';
import { monthlyPence, type PlanKey } from '@/lib/billing/plans';
import { listMyReferrals, type ReferralRow } from '@/lib/billing/referrals';
import { PRO_PLANS, type ProTier } from '@/lib/billing/pro-plans';
import { getAppUrl } from '@/lib/stripe/client';

export type ReferralData = {
  link: string;
  code: string;
  referrals: ReferralRow[];
  /** null = unknown (treated as active, same as the sign-up page) */
  foundingActive: boolean | null;
  /** What one free month is worth to this trader: one month of what they pay (half the list price for a founder). */
  myMonthlyPence: number;
};

/** True when this business holds a founder place. A failed read counts as no (it only changes one number on screen). */
async function holdsFounderPlace(tenantId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('founder_places')
    .select('tenant_id')
    .eq('tenant_id', tenantId)
    .is('released_at', null)
    .maybeSingle();
  return !error && Boolean(data);
}

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
    const [referrals, founding, founder] = await Promise.all([
      listMyReferrals(tenantId),
      getFoundingStatus(),
      holdsFounderPlace(tenantId),
    ]);
    return {
      link: `${getAppUrl()}/r/${code}`,
      code,
      referrals,
      foundingActive: founding.active,
      myMonthlyPence: founder ? Math.round(monthlyPence(plan) / 2) : monthlyPence(plan),
    };
  } catch (err) {
    console.error('[referrals]', err instanceof Error ? err.name : 'Error');
    return null;
  }
}

export type ProReferralData = {
  link: string;
  code: string;
  referrals: ReferralRow[];
  tierName: string;
  /** One month of the referrer's own plan in pence: the most a referral can credit them (monthly list price, even on a yearly plan). */
  myMonthlyPence: number;
};

/** The link, code and list for a Stripe-billed Pro business. No code or any failed read returns null. */
export async function getProReferralData(tenantId: string, tier: ProTier): Promise<ProReferralData | null> {
  try {
    const { data, error } = await createAdminClient()
      .from('tenants')
      .select('referral_code')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) throw new Error('referral code');
    const code = typeof data?.referral_code === 'string' ? data.referral_code : '';
    if (!code) return null;
    const referrals = await listMyReferrals(tenantId);
    return {
      link: `${getAppUrl()}/r/${code}`,
      code,
      referrals,
      tierName: PRO_PLANS[tier].name,
      myMonthlyPence: PRO_PLANS[tier].pence.month,
    };
  } catch (err) {
    console.error('[referrals]', err instanceof Error ? err.name : 'Error');
    return null;
  }
}
