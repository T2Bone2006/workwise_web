/**
 * Cash and cheques a member of staff takes are "held" by them until the owner ticks them handed over (D10, T8).
 * The customer is paid at once (the money engine and the visit are untouched); only the OWNER'S books wait.
 * One place for the rule, used by every report that adds up money the owner has received. Pure.
 */

export type HeldFields = {
  collected_by_worker_id: string | null;
  collected_by_name: string | null;
  handed_over_at: string | null;
  status?: string | null;
  method?: string | null;
};

/** Collected by a person: their worker id, or just their name when their worker row has since gone. */
export function isCollectedByPerson(p: Pick<HeldFields, 'collected_by_worker_id' | 'collected_by_name'>): boolean {
  return Boolean(p.collected_by_worker_id) || Boolean(p.collected_by_name);
}

/** Collected by a person, not handed over yet, and still a live payment. */
export function isHeld(p: HeldFields): boolean {
  if (p.status != null && p.status !== 'active') return false;
  return isCollectedByPerson(p) && !p.handed_over_at;
}

/** True when the payment counts as money the owner has received: not collected by a person, or already handed over. */
export function countsInBooks(p: Pick<HeldFields, 'collected_by_worker_id' | 'collected_by_name' | 'handed_over_at'>): boolean {
  return !isCollectedByPerson(p) || Boolean(p.handed_over_at);
}

/** The date the owner's books use for a payment: the hand-in time for cash a person collected, else when it was received. */
export function bookDate(p: Pick<HeldFields, 'collected_by_worker_id' | 'collected_by_name' | 'handed_over_at'> & { received_at: string }): string {
  return isCollectedByPerson(p) && p.handed_over_at ? p.handed_over_at : p.received_at;
}

/** The columns every money-in query must add so these helpers can be used. */
export const HELD_COLUMNS = 'collected_by_worker_id, collected_by_name, handed_over_at';
