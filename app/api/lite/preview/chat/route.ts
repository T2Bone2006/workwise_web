import { z } from 'zod';
import { requireLite } from '@/lib/lite/require-lite';
import { parseProfile, type PriceProfile } from '@/lib/lite/profile-schema';
import { londonDayBoundsUtc, todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';
import { answerVisitor } from '@/lib/widget/brain';
import { loadWidgetProfile, toPublicQuote } from '@/lib/widget/conversation';

export const runtime = 'nodejs';

const PRACTICE_CAP = 200;
const PRACTICE_LIMIT_MESSAGE = "That's a lot of practice for one day — try again tomorrow.";

const PreviewMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(1000),
});

const PreviewBody = z
  .object({
    messages: z.array(PreviewMessage).min(1).max(60),
    source: z.enum(['live', 'interview']),
  })
  .superRefine((body, ctx) => {
    const first = body.messages[0];
    const last = body.messages[body.messages.length - 1];
    if (first?.role !== 'user' || last?.role !== 'user') {
      ctx.addIssue({ code: 'custom', message: 'bad body', path: ['messages'] });
    }
    const userMessages = body.messages.filter((message) => message.role === 'user').length;
    if (userMessages > 30) {
      ctx.addIssue({ code: 'custom', message: 'too many', path: ['messages'] });
    }
  });

function badBody(): Response {
  return Response.json({ error: 'Check the message and try again.' }, { status: 400 });
}

function limited(): Response {
  return Response.json({ limited: true, message: PRACTICE_LIMIT_MESSAGE }, { status: 429 });
}

/** True when this tenant has already had 200 practice replies today (London), or the count cannot be read. */
async function practiceCapped(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<boolean> {
  try {
    const { startIso } = londonDayBoundsUtc(todayInLondon());
    const { count, error } = await admin
      .from('ai_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('interaction_type', 'widget_chat')
      .eq('input_data->>preview', 'true')
      .gte('created_at', startIso);
    if (error || count == null) return true;
    return count >= PRACTICE_CAP;
  } catch {
    return true;
  }
}

/** Interview draft when one is in progress; otherwise the saved profile. A draft that does not parse stays enquiry mode. */
async function loadPreviewProfile(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  source: 'live' | 'interview',
): Promise<PriceProfile | null> {
  if (source === 'interview') {
    try {
      const { data, error } = await admin
        .from('lite_interviews')
        .select('draft_profile')
        .eq('tenant_id', tenantId)
        .eq('status', 'in_progress')
        .maybeSingle();
      if (error) return null;
      if (data) return parseProfile((data as { draft_profile?: unknown }).draft_profile);
    } catch {
      return null;
    }
  }
  return loadWidgetProfile(admin, tenantId);
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await postPreview(request);
  } catch (err) {
    console.error('[lite preview]', err instanceof Error ? err.name : 'error');
    return Response.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}

async function postPreview(request: Request): Promise<Response> {
  const auth = await requireLite();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badBody();
  }
  const parsed = PreviewBody.safeParse(raw);
  if (!parsed.success) return badBody();

  const admin = createAdminClient();
  if (await practiceCapped(admin, auth.ctx.tenantId)) return limited();

  const profile = await loadPreviewProfile(admin, auth.ctx.tenantId, parsed.data.source);
  const widget = auth.ctx.widget;
  const result = await answerVisitor(admin, {
    tenantId: auth.ctx.tenantId,
    conversationId: 'preview',
    preview: true,
    business: {
      businessName: widget.business_name,
      trade: widget.trade,
      serviceArea: widget.service_area,
      businessContext: widget.business_context,
      signOff: widget.sign_off_name?.trim() || widget.business_name,
    },
    profile,
    history: parsed.data.messages,
  });

  return Response.json({
    reply: result.reply,
    quote: toPublicQuote(result.quote),
    askForDetails: result.askForDetails,
    outOfArea: result.outOfArea,
    mode: profile ? 'quote' : 'enquiry',
  });
}
