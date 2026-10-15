import { format, isValid } from 'date-fns';

/** Statuses an office user can move to cancelled. Completed jobs stay completed. */
export const CANCELLABLE_JOB_STATUSES = [
  'pending',
  'pending_send',
  'assigned',
  'in_progress',
  'paused',
  'incomplete',
  'declined',
] as const;

const FUTURE_SKEW_MS = 5 * 60 * 1000;

export function canCancelJob(status: string | null | undefined): boolean {
  return (
    !!status &&
    (CANCELLABLE_JOB_STATUSES as readonly string[]).includes(status)
  );
}

export function defaultCancellationParts(now = new Date()): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

/** Local date (`yyyy-MM-dd`) and time (`HH:mm`) as an ISO instant, or null if they aren't a real moment. */
export function cancellationIsoFromParts(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}`);
  if (!isValid(parsed)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed.toISOString();
}

export function assertCancellationInstant(
  iso: string,
  now = Date.now()
): { ok: true; iso: string } | { ok: false; error: string } {
  const parsed = new Date(iso);
  if (!isValid(parsed)) {
    return { ok: false, error: 'Choose a cancellation date and time.' };
  }
  if (parsed.getTime() > now + FUTURE_SKEW_MS) {
    return { ok: false, error: "Cancellation time can't be in the future." };
  }
  return { ok: true, iso: parsed.toISOString() };
}

export function formatCancellationStamp(iso: string): string {
  const parsed = new Date(iso);
  if (!isValid(parsed)) return '';
  return format(parsed, 'd MMM yyyy, HH:mm');
}
