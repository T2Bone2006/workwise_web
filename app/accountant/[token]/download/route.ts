import { requireAccountant } from '@/lib/accountant/context';
import { buildAllDataCsvs, buildTaxYearFiles, businessName, taxYearRange } from '@/lib/downloads/builders';
import { jsonError, parseYearQuarter, TOO_MANY, zipFilename, zipResponse } from '@/lib/downloads/respond';
import { textFile } from '@/lib/downloads/zip';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The accountant's downloads, for one tax year (or one quarter of it).
 *   kind=spreadsheets  the money spreadsheets
 *   kind=pack          the year-end pack: spreadsheets + receipt photos + invoice PDFs
 * No customer list, schedules or visits: those aren't built for an accountant. The
 * business always comes from the session, never from the URL.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await requireAccountant(token);
  if (state.status === 'not_found') return jsonError('This link no longer works.', 404);
  if (state.status === 'sign_in') return jsonError('Please sign in again.', 401);

  const url = new URL(request.url);
  const parsed = parseYearQuarter(url.searchParams);
  const kind = url.searchParams.get('kind');
  if (!parsed || (kind !== 'spreadsheets' && kind !== 'pack')) return jsonError('Pick a tax year.', 400);

  const { tenantId } = state.ctx;
  const admin = createAdminClient();
  const year = `${parsed.startYear}-${String((parsed.startYear + 1) % 100).padStart(2, '0')}`;
  const quarter = parsed.quarter ? `-q${parsed.quarter}` : '';

  try {
    const business = await businessName(admin, tenantId);
    if (kind === 'spreadsheets') {
      const files = await buildAllDataCsvs(admin, {
        tenantId,
        audience: 'accountant',
        range: taxYearRange(parsed.startYear, parsed.quarter),
      });
      return zipResponse(
        files.map((f) => textFile(f.name, f.content)),
        zipFilename(business, `spreadsheets-${year}${quarter}`, todayInLondon()),
      );
    }

    const result = await buildTaxYearFiles(admin, {
      tenantId,
      startYear: parsed.startYear,
      quarter: parsed.quarter,
      audience: 'accountant',
    });
    if (!result.ok) return jsonError(TOO_MANY, 409, { invoiceCount: result.invoiceCount });
    return zipResponse(result.files, zipFilename(business, `year-end-pack-${year}${quarter}`, todayInLondon()));
  } catch {
    console.error('[accountant:download] could not build the download');
    return jsonError("Couldn't make the download. Try again.", 500);
  }
}
