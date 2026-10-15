import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
} from '@/lib/api/rounds-request';
import { serviceSchema } from '@/lib/validations/rounds/service';

function isUnique(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.ctx.supabase
    .from('service_catalog')
    .select(
      'id, name, default_price, default_frequency_days, default_duration_minutes, is_active',
    )
    .eq('tenant_id', auth.ctx.tenantId)
    .order('sort_order');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ services: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = serviceSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const { supabase, tenantId } = auth.ctx;
  const { data: last } = await supabase
    .from('service_catalog')
    .select('sort_order')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (typeof last?.sort_order === 'number' ? last.sort_order : 0) + 1;

  const { data, error } = await supabase
    .from('service_catalog')
    .insert({
      tenant_id: tenantId,
      name: parsed.data.name,
      default_price: parsed.data.default_price,
      default_duration_minutes: parsed.data.default_duration_minutes,
      default_frequency_days: parsed.data.default_frequency_days ?? null,
      is_active: parsed.data.is_active,
      sort_order: sortOrder,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json(
      { error: isUnique(error) ? 'A service with this name already exists.' : error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ id: data.id });
}

const patchSchema = serviceSchema.extend({
  id: z.string().uuid(),
});

export async function PATCH(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = patchSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const { error } = await auth.ctx.supabase
    .from('service_catalog')
    .update({
      name: parsed.data.name,
      default_price: parsed.data.default_price,
      default_duration_minutes: parsed.data.default_duration_minutes,
      default_frequency_days: parsed.data.default_frequency_days ?? null,
      is_active: parsed.data.is_active,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.ctx.tenantId);

  if (error) {
    return NextResponse.json(
      { error: isUnique(error) ? 'A service with this name already exists.' : error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
