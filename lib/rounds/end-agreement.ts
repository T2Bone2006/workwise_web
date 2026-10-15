import type { SupabaseClient } from '@supabase/supabase-js';
import { todayInLondon } from '@/lib/rounds/dates';
import {
  AGREEMENT_COLUMNS,
  mapAgreementRow,
  type AgreementRow,
} from '@/lib/rounds/generate-visits';
import { deleteUntouchedFutureVisits } from '@/lib/rounds/visit-transitions';

export type EndAgreementResult =
  | { success: true; customerId: string }
  | { success: false; error: string };

async function loadAgreement(
  supabase: SupabaseClient,
  tenantId: string,
  agreementId: string,
): Promise<AgreementRow | null> {
  const { data, error } = await supabase
    .from('service_agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('id', agreementId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return mapAgreementRow(data as unknown as Record<string, unknown>);
}

/** Stops future visits. Done and skipped history stays. Ending again is a no-op. */
export async function endAgreementCore(
  supabase: SupabaseClient,
  params: { tenantId: string; agreementId: string },
): Promise<EndAgreementResult> {
  const existing = await loadAgreement(supabase, params.tenantId, params.agreementId);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status === 'ended') {
    return { success: true, customerId: existing.customer_id };
  }

  const today = todayInLondon();
  try {
    await deleteUntouchedFutureVisits(supabase, {
      tenantId: params.tenantId,
      agreementId: existing.id,
      fromDate: today,
    });

    const { error } = await supabase
      .from('service_agreements')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        paused_until: null,
      })
      .eq('id', existing.id)
      .eq('tenant_id', params.tenantId);

    if (error) {
      console.error('[endAgreement]', error);
      return { success: false, error: error.message };
    }
  } catch (err) {
    console.error('[endAgreement]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to end agreement',
    };
  }

  return { success: true, customerId: existing.customer_id };
}
