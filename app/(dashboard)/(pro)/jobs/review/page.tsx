import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getUnassignedJobsForTenant } from '@/lib/data/jobs';
import { getConnectionsForTenant } from '@/lib/data/network';
import { getRankedWorkersForJob } from '@/lib/actions/jobs';
import { JobsReviewFlow } from '@/components/jobs/jobs-review-flow';
import { HistoryBackButton } from '@/components/layout/history-back-button';

export default async function JobsReviewPage() {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    redirect('/jobs?error=no_tenant');
  }

  const { jobs: unassignedJobs, error } = await getUnassignedJobsForTenant(tenantId, 100);

  if (error) {
    redirect('/jobs?error=load_failed');
  }

  if (!unassignedJobs || unassignedJobs.length === 0) {
    redirect('/jobs');
  }

  const { connections } = await getConnectionsForTenant(tenantId);
  const activeConnections = connections.filter((connection) => connection.status === 'active');

  const job = unassignedJobs[0]!;
  const rankedResult = await getRankedWorkersForJob(job.id);
  const rankedWorkers = rankedResult.success ? rankedResult.workers : [];
  const workersNoRequiredSkillMatch = rankedResult.success
    ? rankedResult.workersNoRequiredSkillMatch
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <HistoryBackButton iconOnly className="shrink-0" label="Back to jobs" fallbackHref="/jobs" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Jobs for review
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign workers to pending jobs. After each assignment you’ll see the next job.
          </p>
        </div>
      </div>

      <JobsReviewFlow
        job={job}
        totalInQueue={unassignedJobs.length}
        rankedWorkers={rankedWorkers}
        workersNoRequiredSkillMatch={workersNoRequiredSkillMatch}
        queueJobIds={unassignedJobs.map((queuedJob) => queuedJob.id)}
        activeConnections={activeConnections}
      />
    </div>
  );
}
