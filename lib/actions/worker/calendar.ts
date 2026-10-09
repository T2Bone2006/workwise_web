'use server';

import { getMyJobsInRangeResult } from '@/lib/data/worker/jobs';
import { isValidYmd } from '@/lib/rounds/dates';
import { weekStart } from '@/lib/worker/dashboard';
import { WEEK_BOARD_STEP_WEEKS, rangeEnd, type WorkerBoardRange } from '@/lib/worker/week-board';
import type { WorkerJob } from '@/lib/worker/types';

/**
 * More weeks for the worker Week board as you scroll towards either end.
 * The worker always comes from the signed-in session, never from the browser.
 */
export async function loadWorkerCalendarWeeks(input: {
  from: string;
  weeks: number;
}): Promise<{ ok: true; jobs: WorkerJob[]; from: string; to: string } | { ok: false; error: string }> {
  if (!isValidYmd(input.from)) return { ok: false, error: 'Invalid date' };
  const weeks = input.weeks;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > WEEK_BOARD_STEP_WEEKS * 2) {
    return { ok: false, error: 'Pick fewer weeks at a time.' };
  }

  const from = weekStart(input.from);
  const range: WorkerBoardRange = { from, weeks };
  const to = rangeEnd(range);
  const result = await getMyJobsInRangeResult(from, to);
  if (!result.ok) return { ok: false, error: 'Could not load those weeks. Try again.' };
  return { ok: true, jobs: result.jobs, from, to };
}
