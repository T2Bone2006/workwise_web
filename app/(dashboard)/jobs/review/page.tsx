import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getUnassignedJobsForTenant } from '@/lib/data/jobs';
import { getRankedWorkersForJob } from '@/lib/actions/jobs';
import { JobsReviewFlow } from '@/components/jobs/jobs-review-flow';
import { Button } from '@/components/ui/button';

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

  const job = unassignedJobs[0]!;
  const rankedResult = await getRankedWorkersForJob(job.id);
  const rankedWorkers = rankedResult.success ? rankedResult.workers : [];
  const workersNoRequiredSkillMatch = rankedResult.success
    ? rankedResult.workersNoRequiredSkillMatch
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="shrink-0" asChild>
          <Link href="/jobs" aria-label="Back to jobs">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
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
      />
    </div>
  );
}
