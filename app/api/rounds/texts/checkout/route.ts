import { z } from 'zod';
import { createTextPackCheckout } from '@/lib/messaging/text-packs';
import { createAdminClient } from '@/lib/supabase/admin';
import { readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';

const bodySchema = z.object({
  packKey: z.enum(['texts_250', 'texts_1000']),
});

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return roundsJson({ error: 'Unknown pack' }, 400);

  const {
    data: { user },
  } = await auth.ctx.supabase.auth.getUser();

  try {
    const result = await createTextPackCheckout(createAdminClient(), {
      tenantId: auth.ctx.tenantId,
      userEmail: user?.email ?? null,
      packKey: parsed.data.packKey,
      returnTo: 'phone',
    });
    if ('error' in result) return roundsJson({ error: result.error }, 400);
    return roundsJson({ url: result.url });
  } catch (err) {
    console.error('[POST /api/rounds/texts/checkout]', err);
    return roundsJson({ error: 'Could not start checkout' }, 500);
  }
}
