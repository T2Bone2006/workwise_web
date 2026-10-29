'use server';

import { createClient } from '@/lib/supabase/server';
import { getJobsForCustomer, getJobsForExport, type JobsFilters } from '@/lib/data/jobs';
import { customerStatus } from '@/lib/portal/status';
import { incompleteReason } from '@/lib/portal/overview';
import { formatNumericDay, formatNumericStamp } from '@/lib/portal/dates';

export type PortalExportRow = {
  reference: string;
  address: string;
  postcode: string;
  work: string;
  status: string;
  booked: string;
  completed: string;
  reason: string;
};

export type PortalExportResult =
  | { success: true; provider: string; rows: PortalExportRow[]; capped: boolean }
  | { success: false; error: string };

const CHUNK = 150;

export type PortalCountResult = { success: true; count: number } | { success: false; error: string };

/** How many jobs a set of filters matches, so the Export window can say so before downloading. */
export async function countPortalJobsAction(filters: JobsFilters): Promise<PortalCountResult> {
  try {
    const customerId = filters.customer_id;
    if (!customerId) return { success: false, error: 'No customer selected.' };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Please sign in again.' };

    const { data: link } = await supabase
      .from('customer_portal_users')
      .select('customer_id')
      .eq('user_id', user.id)
      .eq('customer_id', customerId)
      .maybeSingle();
    if (!link) return { success: false, error: 'You do not have access to these jobs.' };

    const { totalCount, error } = await getJobsForCustomer(customerId, { ...filters, page: 1 });
    if (error) return { success: false, error: error.message };
    return { success: true, count: totalCount };
  } catch (err) {
    console.error('[countPortalJobsAction]', err);
    return { success: false, error: 'Unable to count jobs.' };
  }
}

/**
 * The signed-in customer's jobs as spreadsheet rows, for the filters chosen in the Export window.
 * Outcomes only: no engineer names, arrival times or time on site.
 * Access is checked here (the customer must be one of the signed-in user's own), and the
 * database still limits every row to that customer.
 */
export async function exportPortalJobsAction(filters: JobsFilters): Promise<PortalExportResult> {
  try {
    const customerId = filters.customer_id;
    if (!customerId) return { success: false, error: 'No customer selected.' };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Please sign in again.' };

    const { data: link } = await supabase
      .from('customer_portal_users')
      .select('customer_id')
      .eq('user_id', user.id)
      .eq('customer_id', customerId)
      .maybeSingle();
    if (!link) return { success: false, error: 'You do not have access to these jobs.' };

    const { data: customer } = await supabase
      .from('customers')
      .select('tenant_id, tenants ( name )')
      .eq('id', customerId)
      .maybeSingle();
    const tenantId = (customer as { tenant_id?: string | null } | null)?.tenant_id;
    if (!tenantId) return { success: false, error: 'Could not find your provider.' };
    const tenants = (customer as { tenants?: { name?: string | null } | Array<{ name?: string | null }> | null }).tenants;
    const provider = ((Array.isArray(tenants) ? tenants[0]?.name : tenants?.name) ?? '').trim() || 'Your provider';

    const { jobs, error } = await getJobsForExport(tenantId, { ...filters, customer_id: customerId });
    if (error) return { success: false, error: error.message };

    // The reason an engineer gave lives in the finish-form answers, which the list query leaves out.
    const reasons = new Map<string, string>();
    const unfinished = jobs.filter((j) => j.status === 'incomplete').map((j) => j.id);
    for (let i = 0; i < unfinished.length; i += CHUNK) {
      const { data } = await supabase
        .from('jobs')
        .select('id, industry_data')
        .in('id', unfinished.slice(i, i + CHUNK));
      for (const row of (data ?? []) as Array<{ id: string; industry_data: Record<string, unknown> | null }>) {
        const reason = incompleteReason(row.industry_data);
        if (reason) reasons.set(row.id, reason);
      }
    }

    const rows: PortalExportRow[] = jobs.map((job) => ({
      reference: job.reference_number ?? '',
      address: job.address ?? '',
      postcode: job.postcode ?? '',
      work: job.job_description ?? '',
      status: customerStatus(job.status).label,
      booked: formatNumericDay(job.scheduled_date) + (job.scheduled_time ? ` ${job.scheduled_time.slice(0, 5)}` : ''),
      completed: formatNumericStamp(job.completed_at),
      reason: reasons.get(job.id) ?? '',
    }));

    return { success: true, provider, rows, capped: jobs.length >= 20000 };
  } catch (err) {
    console.error('[exportPortalJobsAction]', err);
    return { success: false, error: 'Unable to export jobs.' };
  }
}
