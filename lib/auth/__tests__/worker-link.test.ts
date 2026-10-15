import { describe, expect, it } from 'vitest';
import {
  FALLBACK_EMPLOYER_NAME,
  buildWorkerLink,
  dashboardShouldGoToWorker,
  pickWorkerRow,
  type WorkerRowLite,
} from '@/lib/auth/worker-link-core';
import {
  employeeRouteDecision,
  isWorkerAreaPath,
  isWorkerWebPath,
} from '@/lib/auth/worker-web-access';

const row = (over: Partial<WorkerRowLite> = {}): WorkerRowLite => ({
  id: 'w1',
  worker_type: 'employee',
  primary_tenant_id: 'employer',
  invite_status: 'accepted',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe('pickWorkerRow', () => {
  it('returns null when the login has no worker row', () => {
    expect(pickWorkerRow([])).toBeNull();
  });

  it('ignores a Rounds trader\'s own worker row', () => {
    expect(pickWorkerRow([row({ worker_type: 'platform_solo', primary_tenant_id: 'own' })])).toBeNull();
  });

  it('ignores deactivated rows and rows with no employer', () => {
    expect(pickWorkerRow([row({ invite_status: 'deactivated' })])).toBeNull();
    expect(pickWorkerRow([row({ primary_tenant_id: null })])).toBeNull();
  });

  it('accepts a pending row (an invite not yet taken up is still a link)', () => {
    expect(pickWorkerRow([row({ invite_status: 'pending' })])?.id).toBe('w1');
  });

  it('treats a null invite status as live', () => {
    expect(pickWorkerRow([row({ invite_status: null })])?.id).toBe('w1');
  });

  it('prefers an accepted row, then the newest', () => {
    const rows = [
      row({ id: 'old', updated_at: '2026-01-01T00:00:00Z' }),
      row({ id: 'pending-new', invite_status: 'pending', updated_at: '2026-12-01T00:00:00Z' }),
      row({ id: 'new', updated_at: '2026-06-01T00:00:00Z' }),
    ];
    expect(pickWorkerRow(rows)?.id).toBe('new');
  });
});

describe('buildWorkerLink', () => {
  it('marks an employee (login tenant = employer) as having no business of their own', () => {
    const link = buildWorkerLink({ row: row(), usersTenantId: 'employer', employerName: 'Acme Locks' });
    expect(link).toMatchObject({
      workerId: 'w1',
      workerType: 'employee',
      employerTenantId: 'employer',
      employerName: 'Acme Locks',
      hasOwnBusiness: false,
    });
  });

  it('marks a subcontractor (login tenant differs) as having their own business', () => {
    const link = buildWorkerLink({
      row: row({ worker_type: 'company_subcontractor' }),
      usersTenantId: 'own',
      employerName: 'Acme Locks',
    });
    expect(link?.hasOwnBusiness).toBe(true);
    expect(link?.workerType).toBe('company_subcontractor');
  });

  it('falls back to a plain name when the employer cannot be read', () => {
    expect(buildWorkerLink({ row: row(), usersTenantId: 'employer', employerName: null })?.employerName).toBe(
      FALLBACK_EMPLOYER_NAME,
    );
    expect(buildWorkerLink({ row: row(), usersTenantId: 'employer', employerName: '   ' })?.employerName).toBe(
      FALLBACK_EMPLOYER_NAME,
    );
  });

  it('does not claim a business of their own when the login has no tenant', () => {
    expect(buildWorkerLink({ row: row(), usersTenantId: null, employerName: 'A' })?.hasOwnBusiness).toBe(false);
  });
});

describe('dashboardShouldGoToWorker', () => {
  it('sends a worker with no subscription or only Lite to the worker area', () => {
    expect(dashboardShouldGoToWorker({ primary: null, hasWorkerLink: true })).toBe(true);
    expect(dashboardShouldGoToWorker({ primary: 'lite', hasWorkerLink: true })).toBe(true);
  });

  it('leaves Pro and Rounds logins on their own dashboard', () => {
    expect(dashboardShouldGoToWorker({ primary: 'pro', hasWorkerLink: true })).toBe(false);
    expect(dashboardShouldGoToWorker({ primary: 'rounds', hasWorkerLink: true })).toBe(false);
  });

  it('never moves a login that is not a worker', () => {
    expect(dashboardShouldGoToWorker({ primary: null, hasWorkerLink: false })).toBe(false);
    expect(dashboardShouldGoToWorker({ primary: 'lite', hasWorkerLink: false })).toBe(false);
  });
});

describe('worker web paths', () => {
  it('allows the worker area and the pages needed to get in', () => {
    for (const p of ['/worker', '/worker/calendar', '/worker/jobs/abc', '/accept-invite', '/reset-password', '/download']) {
      expect(isWorkerWebPath(p)).toBe(true);
    }
  });

  it('does not allow office pages or look-alike prefixes', () => {
    for (const p of ['/dashboard', '/jobs', '/workers', '/settings', '/workerx', '/customers', '/lite', '/add-lite', '/']) {
      expect(isWorkerWebPath(p)).toBe(false);
    }
  });

  it('only counts /worker and below as the worker area', () => {
    expect(isWorkerAreaPath('/worker')).toBe(true);
    expect(isWorkerAreaPath('/worker/jobs')).toBe(true);
    expect(isWorkerAreaPath('/workers')).toBe(false);
    expect(isWorkerAreaPath('/accept-invite')).toBe(false);
  });
});

describe('employeeRouteDecision', () => {
  it('lets an employee through to the worker area and invite / reset pages', () => {
    expect(employeeRouteDecision('/worker')).toBe('continue');
    expect(employeeRouteDecision('/worker/jobs/1')).toBe('continue');
    expect(employeeRouteDecision('/accept-invite')).toBe('continue');
    expect(employeeRouteDecision('/reset-password')).toBe('continue');
  });

  it('sends an employee home from every office page', () => {
    for (const p of ['/dashboard', '/jobs', '/workers', '/customers', '/settings', '/lite/leads', '/add-lite', '/payments']) {
      expect(employeeRouteDecision(p)).toBe('home');
    }
  });

  it('sends a signed-in employee on /login home instead of signing them out', () => {
    expect(employeeRouteDecision('/login')).toBe('home');
  });
});
