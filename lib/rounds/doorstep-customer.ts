import type { SupabaseClient } from '@supabase/supabase-js';
import { createAgreementCore, jobIdsForAgreement } from '@/lib/rounds/create-agreement';
import { todayInLondon } from '@/lib/rounds/dates';
import { joinHouse } from '@/lib/rounds/house';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { doorstepCustomerSchema } from '@/lib/validations/rounds/agreement';
import { firstZodErrorMessage } from '@/lib/rounds/zod-message';

/**
 * Adding a customer on the doorstep: the customer, their regular service and its first visits, in one go.
 * Shared by the owner's phone (POST /api/rounds/customers) and a member of staff's phone (POST /api/staff/customers).
 * A member of staff passes `addedByWorkerId` (so the owner sees "added by Dave" and can check it) and
 * `assignWorkerId` (so the agreement and its visits are theirs). The owner passes neither and nothing changes for them.
 */

export type DoorstepResult =
  | { ok: true; customerId: string; agreementId: string; jobIds: string[] }
  | { ok: false; status: 400; error: string };

export async function createDoorstepCustomerCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    body: Record<string, unknown>;
    addedByWorkerId?: string | null;
    assignWorkerId?: string | null;
  },
): Promise<DoorstepResult> {
  const { tenantId, body } = p;

  let title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title && typeof body.service_catalog_id === 'string') {
    const { data: catalog } = await supabase
      .from('service_catalog')
      .select('name')
      .eq('id', body.service_catalog_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    title = typeof catalog?.name === 'string' ? catalog.name : '';
  }

  const parsed = doorstepCustomerSchema.safeParse({
    ...body,
    title: title || 'Regular visit',
    anchor_date:
      typeof body.anchor_date === 'string' && body.anchor_date ? body.anchor_date : todayInLondon(),
  });
  if (!parsed.success) return { ok: false, status: 400, error: firstZodErrorMessage(parsed.error) };
  const values = parsed.data;
  const email = values.email?.trim() ? values.email.trim() : null;
  const accessNotes = values.access_notes?.trim() ? values.access_notes.trim() : null;

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .insert({
      tenant_id: tenantId,
      name: values.name,
      type: 'individual',
      email,
      phone: values.phone,
      phone_e164: normalizeUkPhoneE164(values.phone),
      billing_address: joinHouse(values.address, values.postcode),
      access_notes: accessNotes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(p.addedByWorkerId ? { added_by_worker_id: p.addedByWorkerId } : {}),
    })
    .select('id')
    .single();

  if (customerError || typeof customer?.id !== 'string') {
    console.error('[rounds/customers]', customerError);
    return { ok: false, status: 400, error: customerError?.message ?? 'Failed to create customer' };
  }

  const created = await createAgreementCore(supabase, {
    tenantId,
    assignedWorkerId: p.assignWorkerId ?? null,
    values: {
      customer_id: customer.id,
      service_catalog_id: values.service_catalog_id,
      title: values.title,
      address: values.address,
      postcode: values.postcode,
      price: values.price,
      duration_minutes: values.duration_minutes,
      frequency_days: values.frequency_days,
      schedule_mode: values.schedule_mode,
      anchor_date: values.anchor_date,
      preferred_weekday: values.preferred_weekday,
      preferred_time: values.preferred_time,
      reminder_enabled: true,
      access_notes: values.access_notes,
    },
  });

  if (!created.success) {
    await supabase.from('customers').delete().eq('id', customer.id).eq('tenant_id', tenantId);
    return { ok: false, status: 400, error: created.error };
  }

  const jobIds = await jobIdsForAgreement(supabase, { tenantId, agreementId: created.id });
  return { ok: true, customerId: customer.id, agreementId: created.id, jobIds };
}
