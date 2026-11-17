import type { SupabaseClient } from '@supabase/supabase-js';
import { TEXT_ALLOWANCE_PER_MONTH, TRIAL_TEXT_ALLOWANCE } from '@/lib/messaging/credits';

/**
 * Free texts this month for a business: 100, or 50 while every Rounds/Lite subscription it has is still on its
 * free trial. A business with any paid (active or past due) Stripe plan, a manual plan, or a Pro plan gets the
 * full 100. If the lookup fails we give the full 100: a database blip must never stop a customer's texts.
 */
export async function textAllowanceFor(admin: SupabaseClient, tenantId: string): Promise<number> {
  try {
    const { data, error } = await admin
      .from('subscriptions')
      .select('product, status, source')
      .eq('tenant_id', tenantId);
    if (error || !data || data.length === 0) return TEXT_ALLOWANCE_PER_MONTH;
    const live = data.filter((row) => row.status !== 'canceled' && row.status !== 'incomplete_expired');
    if (live.length === 0) return TEXT_ALLOWANCE_PER_MONTH;
    const onlyTrial = live.every(
      (row) => row.status === 'trialing' && row.source === 'stripe' && (row.product === 'rounds' || row.product === 'lite'),
    );
    return onlyTrial ? TRIAL_TEXT_ALLOWANCE : TEXT_ALLOWANCE_PER_MONTH;
  } catch {
    return TEXT_ALLOWANCE_PER_MONTH;
  }
}
