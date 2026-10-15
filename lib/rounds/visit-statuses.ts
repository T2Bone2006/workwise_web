/**
 * Visit status lists with no imports, so any module can read them at load
 * time. (notify.ts ↔ visit-transitions.ts import each other through
 * after-complete.ts; a constant read at load from there is not ready yet.)
 */
export const RESCHEDULE_STATUSES = [
  'assigned',
  'accepted',
  'en_route',
  'arrived',
  'in_progress',
  'paused',
] as const;
