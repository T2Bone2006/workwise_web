import type { SupabaseClient } from '@supabase/supabase-js';
import { AGREEMENT_COLUMNS, mapAgreementRow } from '@/lib/rounds/generate-visits';
import { joinHouse, splitHouse } from '@/lib/rounds/house';
import { updateAgreementCore } from '@/lib/rounds/update-agreement';

/**
 * The address belongs to the customer. It is stored on the customer row and
 * copied onto the services that are at it, because visits take the address from
 * the service they came from.
 *
 * A customer can have services at other properties. Those keep their own
 * address: only services still at the customer's previous address move, so
 * saving the customer form (or changing the address) never pulls a second
 * property back to the first.
 *
 * Expects an already validated address and a normalised postcode. `pin` is an
 * exact spot dropped on the map; it goes onto the services that move.
 */
export async function setCustomerHouseCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    customerId: string;
    address: string;
    postcode: string;
    pin?: { lat: number; lng: number } | null;
  },
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantId, customerId, address, postcode } = params;
  const pin = params.pin ?? null;

  const { data: current, error: currentError } = await supabase
    .from('customers')
    .select('billing_address')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (currentError) return { success: false, error: currentError.message };
  const before = splitHouse((current as { billing_address: string | null } | null)?.billing_address);

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

  const agreements = (data ?? [])
    .map((raw) => mapAgreementRow(raw as unknown as Record<string, unknown>))
    .filter((agreement): agreement is NonNullable<typeof agreement> => agreement != null && agreement.status !== 'ended');

  // Customers saved before the address moved onto them have no stored address.
  // The first service's address stood in for it, so it is "the previous address".
  const previous =
    before.address && before.postcode
      ? before
      : (agreements.find((row) => row.address.trim() && row.postcode.trim()) ?? null);

  for (const agreement of agreements) {
    const atPrevious =
      previous != null && agreement.address === previous.address && agreement.postcode === previous.postcode;
    if (!atPrevious) continue;
    const unchanged = agreement.address === address && agreement.postcode === postcode;
    if (unchanged && !pin) continue;

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
        pin_lat: pin?.lat ?? null,
        pin_lng: pin?.lng ?? null,
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
