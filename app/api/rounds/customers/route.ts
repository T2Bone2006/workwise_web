import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
} from '@/lib/api/rounds-request';
import {
  setCustomerActiveCore,
  updateCustomerProfileCore,
} from '@/lib/rounds/customer-profile';
import { createDoorstepCustomerCore } from '@/lib/rounds/doorstep-customer';
import { setCustomerHouseCore } from '@/lib/rounds/customer-house';
import { agreementSchema } from '@/lib/validations/rounds/agreement';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const result = await createDoorstepCustomerCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    body: json.body,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    customerId: result.customerId,
    agreementId: result.agreementId,
    jobIds: result.jobIds,
  });
}

const profileSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().optional().or(z.literal('')),
  access_notes: z.string().trim().max(500).optional().or(z.literal('')),
  address: agreementSchema.shape.address.optional(),
  postcode: agreementSchema.shape.postcode.optional(),
});

const activeSchema = z.object({
  customerId: z.string().uuid(),
  is_active: z.boolean(),
});

export async function PATCH(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  if ('is_active' in json.body) {
    const parsed = activeSchema.safeParse(json.body);
    if (!parsed.success) {
      return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
    }
    const result = await setCustomerActiveCore(auth.ctx.supabase, {
      tenantId: auth.ctx.tenantId,
      customerId: parsed.data.customerId,
      active: parsed.data.is_active,
    });
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  const parsed = profileSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }
  const result = await updateCustomerProfileCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    customerId: parsed.data.customerId,
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email?.trim() ? parsed.data.email.trim() : null,
    accessNotes: parsed.data.access_notes?.trim() ? parsed.data.access_notes.trim() : null,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (parsed.data.address && parsed.data.postcode) {
    const house = await setCustomerHouseCore(auth.ctx.supabase, {
      tenantId: auth.ctx.tenantId,
      customerId: parsed.data.customerId,
      address: parsed.data.address,
      postcode: parsed.data.postcode,
    });
    if (!house.success) {
      return NextResponse.json({ error: house.error }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
