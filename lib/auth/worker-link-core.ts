/**
 * Pure rules for "is this login a worker, and for whom?". The server read is in
 * worker-link.ts; keeping the rules here makes them testable without a database.
 */

export type WorkerKind = 'employee' | 'company_subcontractor' | 'both';

export type WorkerRowLite = {
  id: string;
  worker_type: string | null;
  primary_tenant_id: string | null;
  invite_status: string | null;
  updated_at?: string | null;
};

export type WorkerLink = {
  workerId: string;
  workerType: WorkerKind;
  employerTenantId: string;
  employerName: string;
  /** users.tenant_id is a different business from the employer (a subcontractor with their own). */
  hasOwnBusiness: boolean;
};

export const FALLBACK_EMPLOYER_NAME = 'your employer';

/**
 * Picks the worker row that links this login to an employer, or null.
 * A row counts when it is not a Rounds trader's own row (platform_solo), has an
 * employer, and is not deactivated. If there are several (should not happen),
 * an accepted one wins, then the most recently updated.
 */
export function pickWorkerRow(rows: readonly WorkerRowLite[]): WorkerRowLite | null {
  const live = rows.filter(
    (row) =>
      row.primary_tenant_id != null &&
      row.worker_type !== 'platform_solo' &&
      row.invite_status !== 'deactivated',
  );
  if (live.length === 0) return null;
  return [...live].sort((a, b) => {
    const accepted = Number(b.invite_status === 'accepted') - Number(a.invite_status === 'accepted');
    if (accepted !== 0) return accepted;
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  })[0];
}

function kindOf(workerType: string | null): WorkerKind {
  return workerType === 'company_subcontractor' || workerType === 'both' ? workerType : 'employee';
}

export function buildWorkerLink(input: {
  row: WorkerRowLite;
  usersTenantId: string | null;
  employerName: string | null;
}): WorkerLink | null {
  const employerTenantId = input.row.primary_tenant_id;
  if (!employerTenantId) return null;
  const name = input.employerName?.trim();
  return {
    workerId: input.row.id,
    workerType: kindOf(input.row.worker_type),
    employerTenantId,
    employerName: name ? name : FALLBACK_EMPLOYER_NAME,
    hasOwnBusiness: input.usersTenantId != null && input.usersTenantId !== employerTenantId,
  };
}

/**
 * Where a signed-in office-style login should land from /dashboard: workers with no
 * subscription of their own (or only Lite) go to the worker area (T10).
 */
export function dashboardShouldGoToWorker(input: {
  primary: 'pro' | 'rounds' | 'lite' | null;
  hasWorkerLink: boolean;
}): boolean {
  if (!input.hasWorkerLink) return false;
  return input.primary === null || input.primary === 'lite';
}
