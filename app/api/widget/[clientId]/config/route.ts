import { createAdminClient } from '@/lib/supabase/admin';
import { loadWidgetProfile } from '@/lib/widget/conversation';
import { guardWidgetRequest, preflightResponse } from '@/lib/widget/guard';
import { makeWidgetSession } from '@/lib/widget/session';

export const runtime = 'nodejs';

export function OPTIONS(request: Request): Response {
  return preflightResponse(request, 'GET, OPTIONS');
}

/** A fresh conversation id and session. Does not create a row or count usage. */
export async function GET(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  try {
    const { clientId } = await context.params;
    const admin = createAdminClient();
    const guard = await guardWidgetRequest(admin, request, clientId, { methods: 'GET, OPTIONS' });
    if (!guard.ok) return guard.response;

    const profile = await loadWidgetProfile(admin, guard.widget.tenant_id);
    const conversationId = crypto.randomUUID();
    const session = makeWidgetSession(clientId, conversationId);
    return Response.json(
      {
        active: true,
        businessName: guard.widget.business_name,
        primaryColour: guard.widget.primary_colour,
        greeting: guard.widget.greeting,
        mode: profile ? 'quote' : 'enquiry',
        conversationId,
        session: session.token,
        sessionExpiresAt: session.expiresAt.toISOString(),
      },
      { headers: guard.cors },
    );
  } catch {
    return Response.json({ active: false }, { status: 503 });
  }
}
