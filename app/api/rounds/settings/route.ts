import { NextResponse } from 'next/server';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
} from '@/lib/api/rounds-request';
import {
  parseRoundsSettings,
  withRoundsSettings,
} from '@/lib/rounds/settings';
import { roundsSettingsSchema } from '@/lib/validations/rounds/settings';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.ctx.supabase
    .from('tenants')
    .select('settings')
    .eq('id', auth.ctx.tenantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const settings = isPlainObject(data?.settings) ? data.settings : {};
  return NextResponse.json({ settings: parseRoundsSettings(settings.rounds) });
}

export async function PATCH(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = roundsSettingsSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const rounds = parseRoundsSettings(parsed.data);
  const { supabase, tenantId } = auth.ctx;
  const { data: tenant, error: loadError } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }

  const current = isPlainObject(tenant?.settings) ? tenant.settings : {};
  const { error } = await supabase
    .from('tenants')
    .update({ settings: withRoundsSettings(current, rounds) })
    .eq('id', tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ settings: rounds });
}
