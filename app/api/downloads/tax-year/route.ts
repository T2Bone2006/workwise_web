import { requireAdminRounds } from '@/lib/auth/require-admin-rounds';
import { businessName, buildTaxYearFiles } from '@/lib/downloads/builders';
import { jsonError, parseYearQuarter, TOO_MANY, zipFilename, zipResponse } from '@/lib/downloads/respond';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
// Drawing a few hundred invoice PDFs and fetching receipts takes a while.
export const maxDuration = 300;

/** "Download a tax year": that year's spreadsheets, receipt photos and invoice PDFs. Account owner only. */
export async function GET(request: Request) {
  const ctx = await requireAdminRounds('Downloads are part of Rounds.');
  if (!ctx.success) return jsonError(ctx.error, ctx.error === 'Not signed in' ? 401 : 403);

  const parsed = parseYearQuarter(new URL(request.url).searchParams);
  if (!parsed) return jsonError('Pick a tax year.', 400);

  try {
    const admin = createAdminClient();
    const result = await buildTaxYearFiles(admin, {
      tenantId: ctx.tenantId,
      startYear: parsed.startYear,
      quarter: parsed.quarter,
      audience: 'trader',
    });
    if (!result.ok) return jsonError(TOO_MANY, 409, { invoiceCount: result.invoiceCount });

    const year = `${parsed.startYear}-${String((parsed.startYear + 1) % 100).padStart(2, '0')}`;
    const suffix = `tax-year-${year}${parsed.quarter ? `-q${parsed.quarter}` : ''}`;
    const name = zipFilename(await businessName(admin, ctx.tenantId), suffix, todayInLondon());
    return zipResponse(result.files, name);
  } catch {
    console.error('[downloads:tax-year] could not build the download');
    return jsonError("Couldn't make the download. Try again.", 500);
  }
}
