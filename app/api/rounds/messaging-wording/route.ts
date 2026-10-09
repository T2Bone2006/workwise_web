import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { getMessagingSettings } from '@/lib/data/messaging/settings';
import { saveMessageWordingCore } from '@/lib/messaging/settings-core';
import { messageWordingPreview } from '@/lib/messaging/templates';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { messageWordingSchema } from '@/lib/validations/messaging';

const wordingRequestSchema = messageWordingSchema.extend({
  save: z.boolean().optional(),
});

/** Bearer preview and save. Same checks as the website's wording editor. */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = wordingRequestSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const loaded = await getMessagingSettings(auth.ctx.supabase, auth.ctx.tenantId);
  const preview = messageWordingPreview(parsed.data.key, parsed.data.body, {
    businessName: loaded.businessName,
    contactPhone: loaded.contact_phone ?? normalizeUkPhoneE164(loaded.companyPhone),
  });

  if (!parsed.data.save) return roundsJson(preview);
  if (preview.error) return roundsJson({ error: preview.error }, 400);

  const saved = await saveMessageWordingCore(
    auth.ctx.supabase,
    auth.ctx.tenantId,
    parsed.data.key,
    parsed.data.body,
  );
  if (!saved.success) return roundsJson({ error: saved.error }, 400);

  revalidatePath('/settings');
  return roundsJson({ success: true });
}
