import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { todayInLondon } from '@/lib/rounds/dates';
import {
  AGREEMENT_COLUMNS,
  generateVisitsForAgreement,
  mapAgreementRow,
} from '@/lib/rounds/generate-visits';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { deleteUntouchedFutureVisits } from '@/lib/rounds/visit-transitions';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function updateCustomerProfileCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    customerId: string;
    name: string;
    phone: string;
    email: string | null;
    accessNotes: string | null;
  },
): Promise<{ success: true } | { success: false; error: string }> {
  const { error } = await supabase
    .from('customers')
    .update({
      name: params.name,
      phone: params.phone,
      phone_e164: normalizeUkPhoneE164(params.phone),
      email: emptyToNull(params.email),
      access_notes: emptyToNull(params.accessNotes),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.customerId)
    .eq('tenant_id', params.tenantId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Deactivate hides the customer and drops visits that have not been started.
 * Agreements stay active so turning them back on rebuilds the round.
 */
export async function setCustomerActiveCore(
  supabase: SupabaseClient,
  params: { tenantId: string; customerId: string; active: boolean },
): Promise<{ success: true } | { success: false; error: string }> {
  const { data: customer, error: loadError } = await supabase
    .from('customers')
    .select('id')
    .eq('id', params.customerId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle();
  if (loadError) return { success: false, error: loadError.message };
  if (!customer) return { success: false, error: 'Customer not found' };

  const today = todayInLondon();
  const { data: agreements, error: agreementError } = await supabase
    .from('service_agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('tenant_id', params.tenantId)
    .eq('customer_id', params.customerId);
  if (agreementError) return { success: false, error: agreementError.message };

  if (!params.active) {
    for (const raw of agreements ?? []) {
      const agreement = mapAgreementRow(raw as unknown as Record<string, unknown>);
      if (!agreement || agreement.status === 'ended') continue;
      await deleteUntouchedFutureVisits(supabase, {
        tenantId: params.tenantId,
        agreementId: agreement.id,
        fromDate: today,
      });
    }
  }

  const { error } = await supabase
    .from('customers')
    .update({
      is_active: params.active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.customerId)
    .eq('tenant_id', params.tenantId);
  if (error) return { success: false, error: error.message };

  if (params.active) {
    const [settings, solo] = await Promise.all([
      getRoundsSettings(supabase, params.tenantId),
      getSoloWorkerForTenant(supabase, params.tenantId),
    ]);
    for (const raw of agreements ?? []) {
      const agreement = mapAgreementRow(raw as unknown as Record<string, unknown>);
      if (!agreement || agreement.status !== 'active') continue;
      await generateVisitsForAgreement(supabase, {
        tenantId: params.tenantId,
        agreement,
        settings,
        workerId: agreement.assigned_worker_id ?? solo?.id ?? null,
      });
    }
  }

  return { success: true };
}
