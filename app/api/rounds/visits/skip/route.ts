import { NextResponse } from 'next/server';
import {
  actorForUser,
  emptyToNull,
  firstZodError,
  readJsonBody,
  requireRoundsApi,
} from '@/lib/api/rounds-request';
import { skipVisitCore } from '@/lib/rounds/visit-transitions';
import { skipVisitSchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = skipVisitSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await skipVisitCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    jobId: parsed.data.jobId,
    reason: parsed.data.reason,
    note: emptyToNull(parsed.data.note),
    actor,
  });
  if (!result.success) {
    const status = result.code === 'already_completed' ? 409 : 400;
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status },
    );
  }

  return NextResponse.json({
    success: true,
    alreadySkipped: result.alreadySkipped,
  });
}
