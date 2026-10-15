/** Pure: progress and the closing sentence of a bulk add, built from the chunk results. */

export type ChunkOutcome = {
  line: number;
  outcome: 'invited' | 'added' | 'failed';
  workerId?: string;
  error?: string;
};

export type BulkProgress = {
  total: number;
  done: number;
  invited: number;
  addedNoInvite: number;
  failed: ChunkOutcome[];
};

export function emptyProgress(total: number): BulkProgress {
  return { total, done: 0, invited: 0, addedNoInvite: 0, failed: [] };
}

export function applyChunk(progress: BulkProgress, results: ReadonlyArray<ChunkOutcome>): BulkProgress {
  const next: BulkProgress = { ...progress, failed: [...progress.failed] };
  for (const r of results) {
    next.done += 1;
    if (r.outcome === 'invited') next.invited += 1;
    else if (r.outcome === 'added') next.addedNoInvite += 1;
    else next.failed.push(r);
  }
  return next;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "38 workers added: 36 invited by email, 2 added without an invite. 1 couldn't be added." */
export function summaryLine(p: BulkProgress): string {
  const added = p.invited + p.addedNoInvite;
  if (added === 0) {
    return p.failed.length === 0 ? 'Nobody was added.' : `Nobody was added. ${plural(p.failed.length, 'worker', 'workers')} couldn't be added.`;
  }
  const parts: string[] = [];
  if (p.invited > 0) parts.push(`${p.invited} invited by email`);
  if (p.addedNoInvite > 0) parts.push(`${p.addedNoInvite} added without an invite`);
  const head = `${plural(added, 'worker', 'workers')} added: ${parts.join(', ')}.`;
  return p.failed.length > 0 ? `${head} ${p.failed.length === 1 ? "1 couldn't be added." : `${p.failed.length} couldn't be added.`}` : head;
}
