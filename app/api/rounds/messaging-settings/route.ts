import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { getMessagingSettings } from '@/lib/data/messaging/settings';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import { saveMessagingSettingsCore } from '@/lib/messaging/settings-core';
import { messagingSettingsSchema } from '@/lib/validations/messaging';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const [loaded, ctx] = await Promise.all([
    getMessagingSettings(auth.ctx.supabase, auth.ctx.tenantId),
    getTenantMessagingContext(auth.ctx.supabase, auth.ctx.tenantId),
  ]);
  const { companyPhone, businessName, ...settings } = loaded;

  return roundsJson({
    settings,
    brand: {
      businessName: ctx?.businessName ?? businessName,
      contactPhone: ctx?.contactPhone ?? settings.contact_phone,
    },
    companyPhone,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = messagingSettingsSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const saved = await saveMessagingSettingsCore(
    auth.ctx.supabase,
    auth.ctx.tenantId,
    parsed.data,
  );
  if (!saved.success) return roundsJson({ error: saved.error }, 400);
  return roundsJson({ success: true });
}
