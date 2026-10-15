import { requireAdminRounds } from '@/lib/auth/require-admin-rounds';
import { businessName, buildAllDataCsvs } from '@/lib/downloads/builders';
import { jsonError, zipFilename, zipResponse } from '@/lib/downloads/respond';
import { textFile } from '@/lib/downloads/zip';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** The business's own "Download all my data": every spreadsheet, as one ZIP. Account owner only. */
export async function GET() {
  const ctx = await requireAdminRounds('Downloads are part of Rounds.');
  if (!ctx.success) {
    return jsonError(ctx.error, ctx.error === 'Not signed in' ? 401 : 403);
  }

  try {
    const admin = createAdminClient();
    const files = await buildAllDataCsvs(admin, { tenantId: ctx.tenantId, audience: 'trader' });
    const name = zipFilename(await businessName(admin, ctx.tenantId), null, todayInLondon());
    return zipResponse(files.map((f) => textFile(f.name, f.content)), name);
  } catch {
    console.error('[downloads:all-data] could not build the download');
    return jsonError("Couldn't make the download. Try again.", 500);
  }
}
