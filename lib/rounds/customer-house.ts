import type { SupabaseClient } from '@supabase/supabase-js';
import { AGREEMENT_COLUMNS, mapAgreementRow } from '@/lib/rounds/generate-visits';
import { joinHouse } from '@/lib/rounds/house';
import { updateAgreementCore } from '@/lib/rounds/update-agreement';

/**
 * The address belongs to the customer. It is stored on the customer row and
 * copied onto each of their services, because visits take the address from
 * the service they came from.
 *
 * Expects an already validated address and a normalised postcode.
 */
export async function setCustomerHouseCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    customerId: string;
    address: string;
    postcode: string;
  },
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantId, customerId, address, postcode } = params;

  const { error } = await supabase
    .from('customers')
    .update({
      billing_address: joinHouse(address, postcode),
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)
    .eq('tenant_id', tenantId);
  if (error) return { success: false, error: error.message };

  const { data, error: loadError } = await supabase
    .from('service_agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId);
  if (loadError) return { success: false, error: loadError.message };

  for (const raw of data ?? []) {
    const agreement = mapAgreementRow(raw as unknown as Record<string, unknown>);
    if (!agreement || agreement.status === 'ended') continue;
    if (agreement.address === address && agreement.postcode === postcode) continue;

    const result = await updateAgreementCore(supabase, {
      tenantId,
      agreementId: agreement.id,
      applyPriceToFuture: false,
      values: {
        customer_id: agreement.customer_id,
        service_catalog_id: agreement.service_catalog_id,
        title: agreement.title,
        address,
        postcode,
        price: agreement.price,
        duration_minutes: agreement.duration_minutes,
        frequency_days: agreement.frequency_days,
        schedule_mode: agreement.schedule_mode,
        anchor_date: agreement.anchor_date,
        preferred_weekday: agreement.preferred_weekday,
        preferred_time: agreement.preferred_time?.slice(0, 5) ?? '',
        default_payment_method: agreement.default_payment_method,
        reminder_enabled: agreement.reminder_enabled,
        access_notes: agreement.access_notes ?? '',
        notes: agreement.notes ?? '',
      },
    });
    if (!result.success) return result;
  }

  return { success: true };
}
