import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { generateVisitsForTenant } from '@/lib/rounds/generate-visits';

/**
 * Daily: keep each Rounds tenant's visit horizon filled.
 * `fixed` agreements get occurrences out to horizon_weeks; `after_completion`
 * only gets a next visit if none is outstanding (offline-Done backfill).
 * Per-tenant failures are reported and do not stop the rest of the run.
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('subscriptions')
    .select('tenant_id')
    .eq('product', 'rounds')
    .in('status', [...ENTITLED_STATUSES]);

  if (error) {
    console.error('[generate-visits] subscriptions', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tenantIds = [
    ...new Set(
      (data ?? [])
        .map((row) => (typeof row.tenant_id === 'string' ? row.tenant_id : null))
        .filter((id): id is string => id != null),
    ),
  ];

  let agreements = 0;
  let inserted = 0;
  let resumed = 0;
  const errors: { tenantId: string; message: string }[] = [];

  for (const tenantId of tenantIds) {
    try {
      const result = await generateVisitsForTenant(admin, { tenantId });
      agreements += result.agreements;
      inserted += result.inserted;
      resumed += result.resumed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[generate-visits] tenant', tenantId, err);
      errors.push({ tenantId, message });
    }
  }

  return NextResponse.json({
    tenants: tenantIds.length,
    agreements,
    inserted,
    resumed,
    errors,
  });
}
