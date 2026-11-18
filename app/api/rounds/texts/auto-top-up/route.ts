import { z } from 'zod';
import { readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import {
  disableAutoTopUp,
  enableAutoTopUp,
  readAutoTopUpSettings,
  resumeAutoTopUp,
} from '@/lib/messaging/auto-top-up';
import { createAdminClient } from '@/lib/supabase/admin';

const bodySchema = z.object({
  enabled: z.boolean(),
  packKey: z.string().optional(),
  triggerLeft: z.number().optional(),
  monthlyCapPounds: z.number().optional(),
  resume: z.boolean().optional(),
});

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;
  try {
    return roundsJson(await readAutoTopUpSettings(createAdminClient(), auth.ctx.tenantId));
  } catch (err) {
    console.error('[GET /api/rounds/texts/auto-top-up]', err);
    return roundsJson({ error: 'Could not load auto top-up' }, 500);
  }
}

export async function PUT(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) return roundsJson({ error: 'Check the numbers and try again' }, 400);
  const input = parsed.data;

  const admin = createAdminClient();
  try {
    if (input.resume) {
      const resumed = await resumeAutoTopUp(admin, auth.ctx.tenantId);
      return 'error' in resumed ? roundsJson(resumed, 400) : roundsJson(resumed);
    }
    if (!input.enabled) {
      const off = await disableAutoTopUp(admin, auth.ctx.tenantId);
      return 'error' in off ? roundsJson(off, 400) : roundsJson(off);
    }
    const {
      data: { user },
    } = await auth.ctx.supabase.auth.getUser();
    const result = await enableAutoTopUp(admin, auth.ctx.tenantId, user?.email ?? null, {
      packKey: input.packKey ?? '',
      triggerLeft: input.triggerLeft ?? Number.NaN,
      monthlyCapPounds: input.monthlyCapPounds ?? Number.NaN,
    });
    return 'error' in result ? roundsJson(result, 400) : roundsJson(result);
  } catch (err) {
    console.error('[PUT /api/rounds/texts/auto-top-up]', err);
    return roundsJson({ error: 'Could not save auto top-up' }, 500);
  }
}

// The phone's request helper sends POST; same behaviour as PUT.
export const POST = PUT;
