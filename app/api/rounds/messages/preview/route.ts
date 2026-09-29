import { z } from 'zod';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import { countSegments } from '@/lib/messaging/gsm';
import {
  afterAllSms,
  dayMovedSms,
  daySkippedSms,
  replyMoveAckSms,
  replySkipAckSms,
  type SmsBrand,
} from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';

const ymd = z.string().refine(isValidYmd, { message: 'Invalid date' });

const previewSchema = z.object({
  kind: z.enum(['day_moved', 'day_skipped', 'after_all', 'reply_skip', 'reply_move']),
  fromDate: ymd.optional(),
  toDate: ymd.optional(),
  date: ymd.optional(),
});

function previewText(
  input: z.output<typeof previewSchema>,
  brand: SmsBrand,
): { ok: true; text: string } | { ok: false; error: string } {
  if (input.kind === 'day_moved') {
    if (!input.fromDate || !input.toDate) return { ok: false, error: 'Invalid date' };
    return {
      ok: true,
      text: dayMovedSms({
        brand,
        fromDay: formatVisitDay(input.fromDate),
        toDay: formatVisitDay(input.toDate),
      }),
    };
  }
  if (input.kind === 'day_skipped') {
    const day = input.date ?? input.fromDate;
    if (!day) return { ok: false, error: 'Invalid date' };
    return {
      ok: true,
      text: daySkippedSms({ brand, day: formatVisitDay(day), nextDay: null }),
    };
  }
  if (input.kind === 'after_all') {
    if (!input.date) return { ok: false, error: 'Invalid date' };
    return { ok: true, text: afterAllSms({ brand, day: formatVisitDay(input.date) }) };
  }
  if (input.kind === 'reply_skip') {
    const day = input.date ?? input.fromDate;
    if (!day) return { ok: false, error: 'Invalid date' };
    return {
      ok: true,
      text: replySkipAckSms({ brand, day: formatVisitDay(day), nextDay: null }),
    };
  }
  const toDay = input.toDate ?? input.date;
  if (!toDay) return { ok: false, error: 'Invalid date' };
  return { ok: true, text: replyMoveAckSms({ brand, toDay: formatVisitDay(toDay) }) };
}

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = previewSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const ctx = await getTenantMessagingContext(auth.ctx.supabase, auth.ctx.tenantId);
  if (!ctx) return roundsJson({ error: 'Could not load your business' }, 400);

  const built = previewText(parsed.data, {
    businessName: ctx.businessName,
    contactPhone: ctx.contactPhone,
  });
  if (!built.ok) return roundsJson({ error: built.error }, 400);

  return roundsJson({
    text: built.text,
    segments: countSegments(built.text).segments,
  });
}
