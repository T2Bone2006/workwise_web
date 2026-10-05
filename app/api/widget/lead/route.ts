import { createAdminClient } from '@/lib/supabase/admin';
import { createLeadFromWidget } from '@/lib/lite/leads-core';
import { widgetLeadSchema } from '@/lib/validations/lite/lead';
import { guardWidgetRequest, preflightResponse } from '@/lib/widget/guard';
import { verifyWidgetSession } from '@/lib/widget/session';

export const runtime = 'nodejs';

const FIELD_MESSAGE = {
  mobile: 'Please enter a UK mobile number.',
  postcode: 'Please check your postcode.',
  email: 'Please check your email address.',
  preferredDays: 'Please check the days you picked.',
  name: 'Please check your name.',
  note: 'Please shorten that note.',
} as const;

const SEND_FAILED = "Sorry, that didn't send — please try again.";

export function OPTIONS(request: Request): Response {
  return preflightResponse(request, 'POST, OPTIONS');
}

function json(body: unknown, status: number, cors?: Record<string, string>): Response {
  return Response.json(body, { status, headers: cors });
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await postLead(request);
  } catch {
    return json({ message: SEND_FAILED }, 503);
  }
}

async function postLead(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'body' }, 400);
  }
  const parsed = widgetLeadSchema.safeParse(raw);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.path[0];
    if (typeof key === 'string' && key in FIELD_MESSAGE) {
      return json({ field: key, message: FIELD_MESSAGE[key as keyof typeof FIELD_MESSAGE] }, 400);
    }
    return json({ error: 'body' }, 400);
  }

  const admin = createAdminClient();
  const guard = await guardWidgetRequest(admin, request, parsed.data.clientId, { methods: 'POST, OPTIONS' });
  if (!guard.ok) return guard.response;
  const { cors } = guard;

  if (!verifyWidgetSession(parsed.data.session, parsed.data.clientId, parsed.data.conversationId)) {
    return json({ error: 'session' }, 401, cors);
  }

  const result = await createLeadFromWidget(admin, {
    widget: guard.widget,
    conversationId: parsed.data.conversationId,
    input: parsed.data,
  });
  if (!result.ok) {
    if (result.error === 'no_conversation') return json({ error: 'no_conversation' }, 404, cors);
    if (result.error === 'save_failed') return json({ message: SEND_FAILED }, 503, cors);
    const field = result.field ?? 'mobile';
    const message = field in FIELD_MESSAGE ? FIELD_MESSAGE[field as keyof typeof FIELD_MESSAGE] : FIELD_MESSAGE.mobile;
    return json({ field, message }, 400, cors);
  }
  if (result.duplicate) return json({ duplicate: true }, 409, cors);
  return json({ ok: true }, 200, cors);
}
