'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { getProCalendarDated } from '@/lib/data/pro-calendar';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { canMove, type ProCalendarJob } from '@/lib/jobs/pro-calendar';
import { BOARD_LOAD_STEP_WEEKS, mondayOf, rangeEnd } from '@/lib/rounds/week-board';

const MAX_JOBS = 200;

/** More weeks for the week board as you scroll towards either end. The business always comes from the login. */
export async function loadProCalendarWeeks(input: {
  from: string;
  weeks: number;
}): Promise<{ success: true; jobs: ProCalendarJob[]; from: Ymd; to: Ymd; truncated: boolean } | { success: false; error: string }> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return { success: false, error: 'Not authenticated' };
  const products = await getTenantProducts();
  if (!products.isPro) return { success: false, error: 'Not available' };
  if (!isValidYmd(input.from)) return { success: false, error: 'Invalid date' };
  if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > BOARD_LOAD_STEP_WEEKS * 2) {
    return { success: false, error: 'Pick fewer weeks at a time.' };
  }
  const from = mondayOf(input.from);
  const to = rangeEnd({ from, weeks: input.weeks });
  const loaded = await getProCalendarDated(tenantId, from, to);
  if (loaded.error) return { success: false, error: 'Could not load those weeks. Try again.' };
  return { success: true, jobs: loaded.jobs, from, to, truncated: loaded.truncated };
}

export type MoveProJobsResult = { success: true; moved: number } | { success: false; error: string };

/**
 * Puts these jobs on a day (or clears the day when `date` is null), in this order.
 * `orderedIds` is the whole column after the drop, not only the jobs that moved.
 */
export async function placeProJobs(date: string | null, orderedIds: string[]): Promise<MoveProJobsResult> {
  try {
    const ids = [...new Set(orderedIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return { success: false, error: 'No jobs to move.' };
    if (ids.length > MAX_JOBS) return { success: false, error: `Move up to ${MAX_JOBS} jobs at a time.` };

    const scheduled = date == null || date === '' ? null : date;
    if (scheduled != null && !isValidYmd(scheduled)) {
      return { success: false, error: 'That date is not valid.' };
    }

    const tenantId = await getOwnerTenantId();
    if (!tenantId) return { success: false, error: 'No tenant assigned.' };

    const supabase = await createClient();
    const { data: owned, error: ownedError } = await supabase
      .from('jobs')
      .select('id, status, scheduled_date')
      .eq('tenant_id', tenantId)
      .in('id', ids);

    if (ownedError) {
      console.error('[placeProJobs]', ownedError);
      return { success: false, error: ownedError.message ?? 'Could not move those jobs.' };
    }
    if (!owned || owned.length !== ids.length) {
      return { success: false, error: 'Some of those jobs could not be moved.' };
    }
    const stuck = owned.find((row) => {
      const current = typeof row.scheduled_date === 'string' ? row.scheduled_date.slice(0, 10) : null;
      return current !== scheduled && !canMove({ status: row.status as string | null });
    });
    if (stuck) {
      return { success: false, error: 'A job that is under way or finished keeps its day.' };
    }

    const now = new Date().toISOString();
    const results = await Promise.all(
      ids.map((id, index) =>
        supabase
          .from('jobs')
          .update({ scheduled_date: scheduled, route_position: index + 1, updated_at: now })
          .eq('tenant_id', tenantId)
          .eq('id', id),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      console.error('[placeProJobs]', failed.error);
      return { success: false, error: failed.error.message ?? 'Could not move those jobs.' };
    }

    revalidatePath('/jobs');
    revalidatePath('/jobs/calendar');
    revalidatePath('/dashboard');
    return { success: true, moved: ids.length };
  } catch (err) {
    console.error('[placeProJobs]', err);
    return { success: false, error: err instanceof Error ? err.message : 'Could not move those jobs.' };
  }
}
