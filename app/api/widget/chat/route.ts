import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PriceProfile } from '@/lib/lite/profile-schema';
import { answerVisitor, BRAIN_FALLBACK_REPLY, type BrainResult } from '@/lib/widget/brain';
import {
  appendAssistantMessage,
  appendVisitorMessage,
  loadConversation,
  loadWidgetProfile,
  startConversation,
  toPublicQuote,
  type ConversationRow,
  type StoredMessage,
} from '@/lib/widget/conversation';
import { guardWidgetRequest, limitedResponse, preflightResponse, type GuardOk } from '@/lib/widget/guard';
import { WIDGET_LIMITS } from '@/lib/widget/limits-config';
import { verifyWidgetSession } from '@/lib/widget/session';
import { claimUsage, visitorConversationsLastHour, visitorHash } from '@/lib/widget/usage';

export const runtime = 'nodejs';

const ChatBody = z.object({
  clientId: z.string().uuid(),
  conversationId: z.string().uuid(),
  session: z.string().min(1),
  message: z.string().trim().min(1).max(WIDGET_LIMITS.messageChars),
});

export function OPTIONS(request: Request): Response {
  return preflightResponse(request, 'POST, OPTIONS');
}

function note(conversationId: string, outcome: string): void {
  console.info('[widget chat]', conversationId, outcome);
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return Response.json(body, { status, headers: cors });
}

function unavailable(cors: Record<string, string>): Response {
  return json({ error: 'unavailable' }, 503, cors);
}

function unauthorized(cors: Record<string, string>): Response {
  return json({ error: 'session' }, 401, cors);
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await postChat(request);
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }
}

async function postChat(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: 'body' }, { status: 400 });
  }
  const parsed = ChatBody.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'body' }, { status: 400 });
  const body = parsed.data;

  const admin = createAdminClient();
  const guard = await guardWidgetRequest(admin, request, body.clientId, { methods: 'POST, OPTIONS' });
  if (!guard.ok) {
    note(body.conversationId, 'refused');
    return guard.response;
  }
  const { cors } = guard;

  if (!verifyWidgetSession(body.session, body.clientId, body.conversationId)) {
    note(body.conversationId, 'session');
    return unauthorized(cors);
  }

  let row = await loadConversation(admin, body.clientId, body.conversationId);
  if (row === 'error') {
    note(body.conversationId, 'unavailable');
    return unavailable(cors);
  }
  if (row && row.client_id !== body.clientId) {
    note(body.conversationId, 'session');
    return unauthorized(cors);
  }

  if (!row) {
    const opened = await openConversation(admin, request, guard, body.conversationId);
    if (opened instanceof Response) return opened;
    row = opened;
  }

  if (row.visitor_message_count >= WIDGET_LIMITS.messagesPerConversation) {
    note(body.conversationId, 'limited');
    return limitedResponse(cors, guard.widget.owner_mobile_e164);
  }
  if (!(await claimUsage(admin, body.clientId, 'message'))) {
    note(body.conversationId, 'limited');
    return limitedResponse(cors, guard.widget.owner_mobile_e164);
  }

  const at = new Date().toISOString();
  const visitorMessage: StoredMessage = { role: 'user', content: body.message, at };
  const appended = await appendVisitorMessage(admin, {
    id: body.conversationId,
    expectedCount: row.visitor_message_count,
    message: visitorMessage,
  });
  if (appended === 'busy') {
    note(body.conversationId, 'busy');
    return json({ busy: true }, 409, cors);
  }
  if (appended === 'error') {
    note(body.conversationId, 'unavailable');
    return unavailable(cors);
  }

  const profile = await loadWidgetProfile(admin, guard.widget.tenant_id);
  const signOff = guard.widget.sign_off_name?.trim() || guard.widget.business_name;
  const brain = await ask(admin, {
    tenantId: guard.widget.tenant_id,
    conversationId: body.conversationId,
    signOff,
    businessName: guard.widget.business_name,
    trade: guard.widget.trade,
    serviceArea: guard.widget.service_area,
    businessContext: guard.widget.business_context,
    profile,
    history: [
      ...row.messages.map((message) => ({ role: message.role, content: message.content })),
      { role: 'user' as const, content: body.message },
    ],
  });

  await appendAssistantMessage(admin, {
    id: body.conversationId,
    message: { role: 'assistant', content: brain.reply, at: new Date().toISOString() },
    quote: brain.quote,
  });

  note(body.conversationId, 'answered');
  return json(
    {
      reply: brain.reply,
      quote: toPublicQuote(brain.quote),
      askForDetails: brain.askForDetails,
      outOfArea: brain.outOfArea,
    },
    200,
    cors,
  );
}

async function openConversation(
  admin: ReturnType<typeof createAdminClient>,
  request: Request,
  guard: GuardOk,
  conversationId: string,
): Promise<ConversationRow | Response> {
  const { cors, widget } = guard;
  const hash = visitorHash(request);
  const recent = await visitorConversationsLastHour(admin, widget.id, hash);
  if (recent == null || recent >= WIDGET_LIMITS.conversationsPerVisitorPerHour) {
    note(conversationId, 'limited');
    return limitedResponse(cors, widget.owner_mobile_e164);
  }
  if (!(await claimUsage(admin, widget.id, 'conversation'))) {
    note(conversationId, 'limited');
    return limitedResponse(cors, widget.owner_mobile_e164);
  }
  const started = await startConversation(admin, {
    id: conversationId,
    clientId: widget.id,
    tenantId: widget.tenant_id,
    visitorHash: hash,
    originHost: guard.originHost,
  });
  if (started === 'error') {
    note(conversationId, 'unavailable');
    return unavailable(cors);
  }
  if (started === 'exists') {
    const again = await loadConversation(admin, widget.id, conversationId);
    if (again === 'error') {
      note(conversationId, 'unavailable');
      return unavailable(cors);
    }
    if (!again || again.client_id !== widget.id) {
      note(conversationId, 'session');
      return unauthorized(cors);
    }
    return again;
  }
  return {
    id: conversationId,
    client_id: widget.id,
    tenant_id: widget.tenant_id,
    messages: [],
    visitor_message_count: 0,
    status: 'active',
  };
}

async function ask(
  admin: ReturnType<typeof createAdminClient>,
  p: {
    tenantId: string;
    conversationId: string;
    signOff: string;
    businessName: string;
    trade: string;
    serviceArea: string;
    businessContext: string;
    profile: PriceProfile | null;
    history: { role: 'user' | 'assistant'; content: string }[];
  },
): Promise<BrainResult> {
  try {
    return await answerVisitor(admin, {
      tenantId: p.tenantId,
      conversationId: p.conversationId,
      business: {
        businessName: p.businessName,
        trade: p.trade,
        serviceArea: p.serviceArea,
        businessContext: p.businessContext,
        signOff: p.signOff,
      },
      profile: p.profile,
      history: p.history,
    });
  } catch {
    return {
      reply: BRAIN_FALLBACK_REPLY(p.signOff),
      quote: null,
      askForDetails: true,
      outOfArea: false,
      usedFallback: true,
    };
  }
}
