/**
 * Pure helpers for showing job groups in the jobs list. Safe for client + server.
 */

import { format, isValid, parseISO } from 'date-fns';

/** The subset of JobRow the list needs to cluster and label groups. */
export interface GroupableJob {
  id: string;
  job_group_id?: string | null;
  job_group_label?: string | null;
  scheduled_date?: string | null;
  customer_name?: string | null;
}

export type JobsDisplayRow<J extends GroupableJob> =
  | { kind: 'job'; job: J }
  | { kind: 'group'; group: { id: string; label: string }; jobs: J[] };

/**
 * Pull each group's members together at the position of its first member,
 * with a header entry in front, keeping the incoming order otherwise. Runs on
 * one page of results — a group straddling a page boundary shows the members
 * present on each page.
 */
export function clusterJobsByGroup<J extends GroupableJob>(jobs: J[]): JobsDisplayRow<J>[] {
  const membersByGroup = new Map<string, J[]>();
  for (const job of jobs) {
    if (!job.job_group_id) continue;
    const bucket = membersByGroup.get(job.job_group_id) ?? [];
    bucket.push(job);
    membersByGroup.set(job.job_group_id, bucket);
  }

  const rows: JobsDisplayRow<J>[] = [];
  const emitted = new Set<string>();
  for (const job of jobs) {
    const groupId = job.job_group_id;
    if (!groupId) {
      rows.push({ kind: 'job', job });
      continue;
    }
    if (emitted.has(groupId)) continue;
    emitted.add(groupId);
    const members = membersByGroup.get(groupId) ?? [job];
    rows.push({
      kind: 'group',
      group: { id: groupId, label: job.job_group_label?.trim() || 'Group' },
      jobs: members,
    });
    for (const member of members) rows.push({ kind: 'job', job: member });
  }
  return rows;
}

/**
 * Default name for a new manual group: the shared customer and/or date when
 * every selected job agrees, otherwise a plain count. The user can overtype it.
 */
export function suggestGroupLabel(jobs: GroupableJob[]): string {
  if (jobs.length === 0) return '';
  const shared = <T>(pick: (j: GroupableJob) => T | null | undefined): T | null => {
    const first = pick(jobs[0]);
    if (first == null || first === '') return null;
    return jobs.every((j) => pick(j) === first) ? first : null;
  };

  const parts: string[] = [];
  const customer = shared((j) => j.customer_name);
  if (customer) parts.push(customer);
  const date = shared((j) => j.scheduled_date);
  if (date) {
    const parsed = parseISO(date);
    parts.push(isValid(parsed) ? format(parsed, 'd MMM') : date);
  }
  if (parts.length === 0) return `${jobs.length} jobs`;
  return `${parts.join(' · ')} (${jobs.length} jobs)`;
}
