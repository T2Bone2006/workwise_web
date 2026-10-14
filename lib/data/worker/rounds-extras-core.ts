/** What a member of staff's website shows beyond a Pro employee's: only for a lead of a Rounds business. */
export type WorkerRoundsExtras = {
  employerIsRounds: boolean;
  /** The business owner's first name (or the business name), for "hand it to …". */
  handToName: string | null;
  /** Cash they are holding for the owner, when above zero. */
  heldCash: { total: number; count: number } | null;
};

export const NOT_ROUNDS: WorkerRoundsExtras = { employerIsRounds: false, handToName: null, heldCash: null };

/** Pure. The cash card only exists when there is cash: £0 is nothing to show. */
export function shapeHeldCash(held: ReadonlyArray<{ amount: number }>, heldTotal: number): WorkerRoundsExtras['heldCash'] {
  const total = Math.round(heldTotal * 100) / 100;
  return total > 0 ? { total, count: held.length } : null;
}

export function firstNameOf(value: string | null | undefined): string | null {
  const first = value?.trim().split(/\s+/)[0];
  return first ? first : null;
}
