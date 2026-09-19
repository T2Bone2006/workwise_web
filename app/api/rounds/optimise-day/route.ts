import { NextResponse } from 'next/server';
import { z } from 'zod';
import { firstZodError, readJsonBody, requireRoundsApi } from '@/lib/api/rounds-request';
import { isValidYmd } from '@/lib/rounds/dates';
import { optimiseDayCore } from '@/lib/rounds/optimise-day';

const bodySchema = z.object({
  date: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  persist: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const result = await optimiseDayCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    date: parsed.data.date,
    persist: parsed.data.persist ?? true,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    stops: result.stops,
    distanceKm: result.distanceKm,
    start: result.start,
  });
}
