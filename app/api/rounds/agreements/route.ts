import { NextResponse } from 'next/server';
import { firstZodError, readJsonBody, requireRoundsApi } from '@/lib/api/rounds-request';
import { createAgreementCore, jobIdsForAgreement } from '@/lib/rounds/create-agreement';
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
