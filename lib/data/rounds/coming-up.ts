import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { readAllPages } from '@/lib/data/read-all-pages';
import { addDays, todayInLondon } from '@/lib/rounds/dates';
import { AGREEMENT_COLUMNS, mapAgreementRow } from '@/lib/rounds/generate-visits';
import {
  buildComingUp,
  mondayOf,
  type BookedStop,
  type ComingUp,
  type ComingUpAgreement,
  type ComingUpWeeks,
} from '@/lib/rounds/coming-up';

/**
 * The forward view for one Rounds business. Read-only: it never writes or
 * generates a visit. A visit that is skipped, declined or incomplete is no longer
 * "coming up"; one done today or later is passed as `done` (the day was worked, so
 * it isn't free, but it isn't work to come); a one-off visit counts as booked.
 */
export async function loadComingUp(
  db: SupabaseClient,
  p: { tenantId: string; weeks: ComingUpWeeks; today?: string },
): Promise<ComingUp> {
  const today = p.today ?? todayInLondon();
  const from = mondayOf(today);
  const until = addDays(from, p.weeks * 7 - 1);

  const [settings, jobRows, agreementRows] = await Promise.all([
    getRoundsSettings(db, p.tenantId),
    readAllPages(
      (a, z) =>
        db
          .from('jobs')
          .select('id, customer_id, status, scheduled_date, quoted_amount, service_agreement_id, agreement_occurrence_date')
          .eq('tenant_id', p.tenantId)
          .gte('scheduled_date', from)
          .lte('scheduled_date', until)
          .not('status', 'in', '(cancelled,declined,incomplete)')
          .order('scheduled_date', { ascending: true })
          .order('id', { ascending: true })
          .range(a, z),
      'Could not load visits',
    ),
    readAllPages(
      (a, z) =>
        db
          .from('service_agreements')
          .select(AGREEMENT_COLUMNS)
          .eq('tenant_id', p.tenantId)
          .in('status', ['active', 'paused'])
          .order('id', { ascending: true })
          .range(a, z),
      'Could not load schedules',
    ),
  ]);

  const booked: BookedStop[] = jobRows.flatMap((r) =>
    typeof r.scheduled_date === 'string' && !(r.status === 'completed' && r.scheduled_date.slice(0, 10) < today)
      ? [
          {
            scheduledDate: r.scheduled_date.slice(0, 10),
            customerId: typeof r.customer_id === 'string' ? r.customer_id : null,
            done: r.status === 'completed',
            amount: r.quoted_amount == null ? null : Number(r.quoted_amount),
            agreementId: typeof r.service_agreement_id === 'string' ? r.service_agreement_id : null,
            occurrenceDate:
              typeof r.agreement_occurrence_date === 'string' ? r.agreement_occurrence_date.slice(0, 10) : null,
          },
        ]
      : [],
  );

  const agreements: ComingUpAgreement[] = [];
  for (const raw of agreementRows) {
    const row = mapAgreementRow(raw);
    if (row) agreements.push(row);
  }

  return buildComingUp({ today, weeks: p.weeks, settings, booked, agreements });
}
