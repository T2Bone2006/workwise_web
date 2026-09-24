import { NextResponse } from 'next/server';
import { z } from 'zod';
import { firstZodError, readJsonBody, requireRoundsApi } from '@/lib/api/rounds-request';
import { createAgreementCore, jobIdsForAgreement } from '@/lib/rounds/create-agreement';
import { updateAgreementCore } from '@/lib/rounds/update-agreement';
import { agreementSchema } from '@/lib/validations/rounds/agreement';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = agreementSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const created = await createAgreementCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    values: parsed.data,
  });
  if (!created.success) {
    return NextResponse.json({ error: created.error }, { status: 400 });
  }

  const jobIds = await jobIdsForAgreement(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    agreementId: created.id,
  });

  return NextResponse.json({
    agreementId: created.id,
    jobIds,
  });
}

const patchSchema = agreementSchema.extend({
  agreementId: z.string().uuid('Invalid agreement'),
  applyPriceToFuture: z.boolean().optional(),
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

  const { agreementId, applyPriceToFuture, ...values } = parsed.data;
  const result = await updateAgreementCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    agreementId,
    values,
    applyPriceToFuture: applyPriceToFuture ?? true,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ regenerated: result.regenerated });
}
