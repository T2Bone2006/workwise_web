import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { oneOffReferenceNumber } from '@/lib/rounds/recurrence';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import type { Actor } from '@/lib/rounds/visit-transitions';
import { resolveJobCoordinates } from '@/lib/utils/geocoding';
import type { OneOffVisitValues } from '@/lib/validations/rounds/visit';

/** A customer the one-off form can pick, with the address to fill in. */
export type OneOffCustomerOption = {
  id: string;
  name: string;
  /** From their newest active agreement (else newest of any); null when they have none. */
  address: string | null;
  postcode: string | null;
  accessNotes: string | null;
};

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function random4hex(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 4);
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Active customers A–Z, each with the address of their newest active agreement
 * (or newest agreement of any status). The address lives on the agreement,
 * not the customer, in Rounds.
 */
export async function listOneOffCustomerOptions(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ options: OneOffCustomerOption[]; error: string | null }> {
  const [customers, agreements] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, access_notes')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('service_agreements')
      .select('customer_id, address, postcode, access_notes, status, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ]);
  if (customers.error) return { options: [], error: customers.error.message };
  if (agreements.error) return { options: [], error: agreements.error.message };

  type Place = { address: string; postcode: string | null; accessNotes: string | null };
  const active = new Map<string, Place>();
  const any = new Map<string, Place>();
  for (const raw of (agreements.data ?? []) as Record<string, unknown>[]) {
    const customerId = asText(raw.customer_id);
    const address = asText(raw.address);
    if (!customerId || !address) continue;
    const place = {
      address,
      postcode: asText(raw.postcode),
      accessNotes: asText(raw.access_notes),
    };
    // Rows are newest first, so the first one seen per customer wins.
    if (!any.has(customerId)) any.set(customerId, place);
    if (raw.status === 'active' && !active.has(customerId)) active.set(customerId, place);
  }

  const options: OneOffCustomerOption[] = [];
  for (const raw of (customers.data ?? []) as Record<string, unknown>[]) {
    const id = asText(raw.id);
    if (!id) continue;
    const place = active.get(id) ?? any.get(id) ?? null;
    options.push({
      id,
      name: asText(raw.name) ?? 'Customer',
      address: place?.address ?? null,
      postcode: place?.postcode ?? null,
      accessNotes: place?.accessNotes ?? asText(raw.access_notes),
    });
  }
  return { options, error: null };
}

/** Insert one visit not tied to an agreement. Shared by the dashboard action and the phone API. */
export async function createOneOffVisitCore(
  supabase: SupabaseClient,
  p: { tenantId: string; actor: Actor; values: OneOffVisitValues },
): Promise<{ success: true; jobId: string } | { success: false; error: string }> {
  const { tenantId, actor, values } = p;

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .eq('id', values.customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (customerError) return { success: false, error: customerError.message };
  if (!customer) return { success: false, error: 'Customer not found' };

  const [coords, solo] = await Promise.all([
    resolveJobCoordinates({
      postcode: values.postcode,
      fullAddress: `${values.address}, ${values.postcode}`,
    }),
    getSoloWorkerForTenant(supabase, tenantId),
  ]);

  const scheduledTime = emptyToNull(values.scheduled_time);
  const accessNotes = emptyToNull(values.access_notes);

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      tenant_id: tenantId,
      reference_number: oneOffReferenceNumber(values.scheduled_date, random4hex()),
      customer_id: values.customer_id,
      assigned_worker_id: solo?.id ?? null,
      service_agreement_id: null,
      agreement_occurrence_date: null,
      address: values.address,
      postcode: values.postcode,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      job_description: values.title,
      status: 'assigned',
      priority: 'normal',
      scheduled_date: values.scheduled_date,
      scheduled_time: scheduledTime,
      estimated_duration_minutes: values.duration_minutes,
      quoted_amount: values.price,
      payment_status: 'unpaid',
      customer_confirmation_status: null,
      route_position: null,
      required_skills: [],
      industry_data: {},
      custom_fields: {
        rounds: {
          agreement_id: null,
          service_name: null,
          access_notes: accessNotes,
        },
      },
    })
    .select('id')
    .single();

  if (error || typeof data?.id !== 'string') {
    console.error('[createOneOffVisit]', error);
    return { success: false, error: error?.message ?? 'Failed to create job' };
  }

  const { error: historyError } = await supabase.from('job_status_history').insert({
    job_id: data.id,
    from_status: null,
    to_status: 'assigned',
    created_at: new Date().toISOString(),
    changed_by_user_id: actor.userId ?? null,
    changed_by_worker_id: actor.workerId ?? null,
    notes: 'One-off visit',
    metadata: {},
  });
  if (historyError) {
    console.error('[createOneOffVisit] job_status_history', historyError);
  }

  return { success: true, jobId: data.id };
}
