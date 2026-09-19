import { NextResponse } from 'next/server';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
} from '@/lib/api/rounds-request';
import { createAgreementCore, jobIdsForAgreement } from '@/lib/rounds/create-agreement';
import { todayInLondon } from '@/lib/rounds/dates';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { doorstepCustomerSchema } from '@/lib/validations/rounds/agreement';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const { supabase, tenantId } = auth.ctx;
  const body = json.body;

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
      typeof body.anchor_date === 'string' && body.anchor_date
        ? body.anchor_date
        : todayInLondon(),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }
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
      access_notes: accessNotes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (customerError || typeof customer?.id !== 'string') {
    console.error('[rounds/customers]', customerError);
    return NextResponse.json(
      { error: customerError?.message ?? 'Failed to create customer' },
      { status: 400 },
    );
  }

  const created = await createAgreementCore(supabase, {
    tenantId,
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
    await supabase
      .from('customers')
      .delete()
      .eq('id', customer.id)
      .eq('tenant_id', tenantId);
    return NextResponse.json({ error: created.error }, { status: 400 });
  }

  const jobIds = await jobIdsForAgreement(supabase, {
    tenantId,
    agreementId: created.id,
  });

  return NextResponse.json({
    customerId: customer.id,
    agreementId: created.id,
    jobIds,
  });
}
