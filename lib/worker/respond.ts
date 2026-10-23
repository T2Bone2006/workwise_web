/**
 * Answering a job from the website: the rules that need no database, kept apart so they can be tested.
 * The phone does the same two writes (status 'accepted', or 'declined' with an optional reason); the
 * database triggers do the rest (history row, hand-back to the office).
 */

export const DECLINE_REASON_MAX = 500;

export type RespondResult = { ok: true } | { ok: false; error: string };

export const RESPOND_MESSAGES = {
  badJob: 'We could not find that job.',
  notConnected: 'You are not connected to an employer, so there is nothing to answer.',
  visit: 'A visit on a round does not need accepting.',
  changed: 'This job has changed since you opened it, so it can no longer be answered here. Refresh to see where it is.',
  failed: "We couldn't save that. Try again.",
} as const;

/** A job id is a UUID; anything else never reaches the database. */
export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** The reason box is optional: blank or not text means no reason; long text is cut to fit. */
export function cleanDeclineReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > DECLINE_REASON_MAX ? text.slice(0, DECLINE_REASON_MAX).trimEnd() : text;
}

/** A job the worker can still answer: sent to them, not accepted or declined, and not a Rounds visit. */
export function canRespond(job: { status: string; rounds?: true }): boolean {
  return job.status === 'assigned' && !job.rounds;
}
