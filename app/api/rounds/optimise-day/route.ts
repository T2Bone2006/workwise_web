import { NextResponse } from 'next/server';
import { z } from 'zod';
import { firstZodError, readJsonBody, requireRoundsApi } from '@/lib/api/rounds-request';
import { isValidYmd } from '@/lib/rounds/dates';
import { optimiseDayCore } from '@/lib/rounds/optimise-day';
import { normalizeUkPostcode } from '@/lib/utils/postcode';

const bodySchema = z.object({
  date: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  persist: z.boolean().optional(),
  startPostcode: z.string().trim().max(12).nullable().optional(),
  finishPostcode: z.string().trim().max(12).nullable().optional(),
});

function readOptionalPostcode(
  raw: string | null | undefined,
): { ok: true; postcode: string | null } | { ok: false; error: string } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, postcode: null };
  const postcode = normalizeUkPostcode(trimmed);
  if (!postcode) return { ok: false, error: 'Enter a UK postcode.' };
  return { ok: true, postcode };
}

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
  }

  const startPostcode = readOptionalPostcode(parsed.data.startPostcode);
  if (!startPostcode.ok) {
    return NextResponse.json({ error: startPostcode.error }, { status: 400 });
  }
  const finishPostcode = readOptionalPostcode(parsed.data.finishPostcode);
  if (!finishPostcode.ok) {
    return NextResponse.json({ error: finishPostcode.error }, { status: 400 });
  }

  const result = await optimiseDayCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    date: parsed.data.date,
    persist: parsed.data.persist ?? true,
    startPostcode: startPostcode.postcode,
    finishPostcode: finishPostcode.postcode,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    stops: result.stops,
    distanceKm: result.distanceKm,
    start: result.start,
    finish: result.finish,
  });
}
