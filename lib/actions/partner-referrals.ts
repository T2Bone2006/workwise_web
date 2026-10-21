'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { normaliseSignupCode } from '@/lib/billing/partner-share';
import { owedPenceForReferral } from '@/lib/billing/partner-referrals';
import { requireAdmin } from '@/lib/utils/admin';

export type PartnerActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh() {
  revalidatePath('/admin/referrals');
}

/** Adds a hand-picked partner. Their code then gives a new Rounds or Lite trader the free month. */
export async function createReferralPartner(
  _prev: PartnerActionResult | null,
  formData: FormData,
): Promise<PartnerActionResult> {
  await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const code = normaliseSignupCode(formData.get('code'));
  const payout = String(formData.get('payoutNote') ?? '').trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'Enter their name (2 to 80 characters).' };
  if (!code) return { ok: false, error: 'Use 3 to 16 letters or numbers, with no spaces.' };
  if (payout.length > 200) return { ok: false, error: 'Keep the payment note under 200 characters.' };

  const admin = createAdminClient();
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id')
    .eq('referral_code', code)
    .maybeSingle();
  if (tenantError) return { ok: false, error: 'Could not check that code. Try again.' };
  if (tenant) return { ok: false, error: 'That code already belongs to a WorkWise customer.' };

  const { error } = await admin.from('referral_partners').insert({
    name,
    code,
    payout_note: payout || null,
  });
  if (error && (error as { code?: string }).code === '23505') {
    return { ok: false, error: 'That code is already in use.' };
  }
  if (error) return { ok: false, error: 'Could not save that code.' };
  refresh();
  return { ok: true };
}

/** False stops new signups using the code. Businesses already referred keep their 12 months. */
export async function setPartnerActive(partnerId: string, active: boolean, _formData: FormData): Promise<void> {
  await requireAdmin();
  if (!UUID.test(partnerId)) return;
  const admin = createAdminClient();
  const { error } = await admin.from('referral_partners').update({ active }).eq('id', partnerId);
  if (error) console.error('[partner-referrals]', error.code ?? 'update');
  refresh();
}

/** Sets paid_pence to the 10% owed at this moment. Later invoices show as owing again. */
export async function markPartnerReferralPaid(referralId: string, _formData: FormData): Promise<void> {
  await requireAdmin();
  if (!UUID.test(referralId)) return;
  const owed = await owedPenceForReferral(referralId);
  if (owed == null) return;
  const admin = createAdminClient();
  const { error } = await admin.from('partner_referrals').update({ paid_pence: owed }).eq('id', referralId);
  if (error) console.error('[partner-referrals]', error.code ?? 'update');
  refresh();
}
