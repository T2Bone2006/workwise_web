/**
 * Display helpers for a job's scheduled time window.
 * Jobs carry an optional start (`scheduled_time`) and finish (`end_time`);
 * `job_length` is the coarse fallback for customers who never give exact times.
 */

/** `14:30:00` / `14:30` → `14:30`. Returns '' for empty input. */
export function toShortTime(time: string | null | undefined): string {
  const raw = String(time ?? '').trim();
  if (!raw) return '';
  return raw.slice(0, 5);
}

/**
 * "09:00 – 10:00" when both times exist, "09:00" with only a start,
 * "→ 10:00" with only a finish, otherwise null.
 */
export function formatTimeRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): string | null {
  const start = toShortTime(startTime);
  const end = toShortTime(endTime);
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (end) return `→ ${end}`;
  return null;
}

/** "Half day" / "Full day" for the coarse duration enum. */
export function formatJobLength(
  jobLength: 'half_day' | 'full_day' | null | undefined
): string | null {
  if (jobLength === 'half_day') return 'Half day';
  if (jobLength === 'full_day') return 'Full day';
  return null;
}

/** Exact times when the job has them, else the coarse job length, else null. */
export function formatTimeRangeOrLength(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  jobLength: 'half_day' | 'full_day' | null | undefined
): string | null {
  return formatTimeRange(startTime, endTime) ?? formatJobLength(jobLength);
}
