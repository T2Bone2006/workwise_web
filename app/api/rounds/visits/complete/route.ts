import { NextResponse } from 'next/server';
import {
  actorForUser,
  emptyToNull,
  firstZodError,
  readJsonBody,
  requireRoundsApi,
} from '@/lib/api/rounds-request';
import { completeVisitCore } from '@/lib/rounds/visit-transitions';
import { completeVisitSchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = completeVisitSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await completeVisitCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    jobId: parsed.data.jobId,
    finalAmount: parsed.data.finalAmount,
    notes: emptyToNull(parsed.data.notes),
    actor,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
