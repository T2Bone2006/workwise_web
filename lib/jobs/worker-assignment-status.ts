/** Statuses that must not change when (re)assigning a worker. */
const PRESERVED_STATUSES = new Set([
  'in_progress',
  'completed',
  'cancelled',
  'paused',
  'en_route',
  'arrived',
  'accepted',
]);

/**
 * Statuses that move to `pending_send` when a worker is assigned or reassigned.
 * Includes `declined`: a declined job now stays declined until a dispatcher
 * assigns someone (see handle_job_declined() — it no longer auto-bounces to
 * pending), so assigning must actively promote it, not leave it frozen.
 */
const PROMOTE_TO_PENDING_SEND = new Set(['pending', 'assigned', 'pending_send', 'declined']);

/**
 * Job status after setting `assigned_worker_id` (create, assign, or reassign).
 * New jobs with a worker use `statusAfterWorkerAssignment('pending')`.
 */
export function statusAfterWorkerAssignment(currentStatus: string): string {
  if (PRESERVED_STATUSES.has(currentStatus)) {
    return currentStatus;
  }
  if (PROMOTE_TO_PENDING_SEND.has(currentStatus)) {
    return 'pending_send';
  }
  return currentStatus;
}
