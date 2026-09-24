import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
} from '@/lib/api/rounds-request';

const profileSchema = z.object({
  full_name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(20),
  business_name: z.string().trim().min(2).max(80),
});

export async function PATCH(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = profileSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const { supabase, tenantId, userId } = auth.ctx;
  const { full_name, phone, business_name } = parsed.data;

  const { error: workerError } = await supabase
    .from('workers')
    .update({ full_name, phone, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (workerError) {
    return NextResponse.json({ error: workerError.message }, { status: 400 });
  }

  const { error: tenantError } = await supabase
    .from('tenants')
    .update({ name: business_name, updated_at: new Date().toISOString() })
    .eq('id', tenantId);

  if (tenantError) {
    return NextResponse.json({ error: tenantError.message }, { status: 400 });
  }

  return NextResponse.json({ full_name, phone, business_name });
}
