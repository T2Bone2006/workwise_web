'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, MapPin, FileText, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { assignJob, autoAllocateJob } from '@/lib/actions/jobs';
import type { RankedWorkerForJob } from '@/lib/jobs/worker-skill-match';
import { cn } from '@/lib/utils';
import type { JobRow } from '@/lib/data/jobs';

/** Primary list: workers with ≥1 required skill match (or all workers if job has no requirements). */
const MAX_SKILL_MATCH_WORKERS = 5;
/** Secondary list: closest single worker with no required skill overlap. */
const MAX_NO_SKILL_MATCH_WORKERS = 1;

interface JobsReviewFlowProps {
  job: JobRow;
  totalInQueue: number;
  rankedWorkers: RankedWorkerForJob[];
  workersNoRequiredSkillMatch: RankedWorkerForJob[];
}

function WorkerSkillBreakdown({
  w,
  jobHasRequirements,
  requiredCount,
}: {
  w: RankedWorkerForJob;
  jobHasRequirements: boolean;
  requiredCount: number;
}) {
  if (!jobHasRequirements) {
    return (
      <p className="text-xs text-muted-foreground">No skill requirements for this job</p>
    );
  }
  const { matchedRequiredSkills } = w;
  if (requiredCount > 0 && matchedRequiredSkills.length === requiredCount) {
    return (
      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">All skills matched</p>
    );
  }
  if (matchedRequiredSkills.length === 0) {
    return <p className="text-xs text-muted-foreground">No matching skills</p>;
  }
  return (
    <div className="space-y-1 text-left">
      <p className="text-xs text-emerald-700 dark:text-emerald-300">
        <span className="font-medium">Matched:</span> {w.matchedRequiredSkills.join(', ')}
      </p>
      <p className="text-xs text-amber-800 dark:text-amber-200">
        <span className="font-medium">Missing:</span> {w.missingRequiredSkills.join(', ')}
      </p>
    </div>
  );
}

function WorkerCard({
  w,
  selected,
  onSelect,
  jobHasRequirements,
  requiredCount,
}: {
  w: RankedWorkerForJob;
  selected: boolean;
  onSelect: (id: string) => void;
  jobHasRequirements: boolean;
  requiredCount: number;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(w.id)}
      className={cn(
        'w-full rounded-xl border p-3 text-left transition-all',
        'border-border/80 bg-background/40 hover:border-primary/35 hover:bg-primary/[0.04]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-primary/60 bg-primary/8 ring-2 ring-primary/35'
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{w.full_name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {w.distanceKm != null ? (
              <>
                <span className="tabular-nums">{w.distanceKm.toFixed(1)} km</span>
                <span> from job</span>
              </>
            ) : (
              <span>Distance unavailable (add home location)</span>
            )}
          </p>
          <div className="mt-2">
            <WorkerSkillBreakdown
              w={w}
              jobHasRequirements={jobHasRequirements}
              requiredCount={requiredCount}
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end sm:pt-0.5">
          <span
            className={cn(
              'inline-flex rounded-full border border-border/80 px-2 py-0.5 text-xs tabular-nums text-muted-foreground'
            )}
          >
            Active: {w.currentJobs}
          </span>
        </div>
      </div>
    </button>
  );
}

export function JobsReviewFlow({
  job,
  totalInQueue,
  rankedWorkers,
  workersNoRequiredSkillMatch,
}: JobsReviewFlowProps) {
  const requiredSkills = job.required_skills ?? [];
  const requiredCount = requiredSkills.length;
  const jobHasRequirements = requiredCount > 0;

  const router = useRouter();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [autoAssignError, setAutoAssignError] = useState<string | null>(
    () => job.auto_assign_failure_reason ?? null
  );

  useEffect(() => {
    setSelectedWorkerId(null);
    setAutoAssignError(job.auto_assign_failure_reason ?? null);
  }, [job.id, job.auto_assign_failure_reason]);

  async function handleAutoAssign() {
    setAutoAssignError(null);
    setIsAutoAssigning(true);
    try {
      const result = await autoAllocateJob(job.id);
      if (result.success) {
        toast.success(
          `Allocated to ${result.workerName} (${result.distance}km away). Send from Jobs when ready.`
        );
        router.refresh();
      } else {
        const errMsg =
          typeof result.error === 'string' && result.error.trim().length > 0
            ? result.error.trim()
            : 'Auto-assignment failed';
        setAutoAssignError(errMsg);
        router.refresh();
      }
    } catch {
      const errMsg = 'Failed to auto-assign';
      setAutoAssignError(errMsg);
      router.refresh();
    } finally {
      setIsAutoAssigning(false);
    }
  }

  async function handleAssign() {
    if (!selectedWorkerId) {
      toast.error('Select a worker first');
      return;
    }
    setIsAssigning(true);
    try {
      const result = await assignJob(job.id, selectedWorkerId, { pendingSend: true });
      if (result.success) {
        toast.success('Worker assigned');
        setSelectedWorkerId(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to assign worker');
    } finally {
      setIsAssigning(false);
    }
  }

  /** Already sorted by distance server-side; cap list lengths for a tighter UI. */
  const skillMatchListWorkers = rankedWorkers.slice(0, MAX_SKILL_MATCH_WORKERS);
  const noSkillMatchListWorkers = workersNoRequiredSkillMatch.slice(
    0,
    MAX_NO_SKILL_MATCH_WORKERS
  );

  const totalRanked = skillMatchListWorkers.length + noSkillMatchListWorkers.length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          Job 1 of {totalInQueue} needing assignment
        </p>
      </div>

      <div
        className={cn(
          'rounded-2xl border border-border/80 p-6',
          'bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]',
          'backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-foreground">{job.reference_number ?? job.id.slice(0, 8)}</span>
            {job.customer_name && (
              <span className="text-muted-foreground">· {job.customer_name}</span>
            )}
          </div>
          <div className="grid gap-2 text-sm">
            {job.address && (
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  {job.address}
                  {job.postcode && `, ${job.postcode}`}
                </span>
              </div>
            )}
            {job.job_description && (
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{job.job_description}</span>
              </div>
            )}
            {job.scheduled_date && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="size-4 shrink-0" />
                <span>Scheduled: {job.scheduled_date}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'rounded-2xl border border-border/80 p-6',
          'bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]',
          'backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <h3 className="mb-4 font-semibold text-foreground">Assign worker</h3>
        <div className="space-y-4">
          <Button
            type="button"
            variant="gradient"
            size="lg"
            className="w-full gap-2 shadow-[var(--shadow-btn-glow-value)]"
            onClick={handleAutoAssign}
            disabled={isAutoAssigning || isAssigning}
          >
            {isAutoAssigning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Auto-assign (location & availability)
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/60" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[var(--glass-bg)] px-2 text-muted-foreground">
                Or choose manually (best match first)
              </span>
            </div>
          </div>

          {autoAssignError && (
            <div
              role="alert"
              className={cn(
                'rounded-lg border px-3 py-3 text-sm shadow-sm',
                'border-amber-500/50 bg-amber-500/[0.12] text-foreground',
                'dark:border-amber-400/40 dark:bg-amber-500/15'
              )}
            >
              <span className="font-semibold text-amber-950 dark:text-amber-100">
                Auto-assign failed:{' '}
              </span>
              <span className="text-amber-950/95 dark:text-amber-50/95">{autoAssignError}</span>
            </div>
          )}

          {totalRanked === 0 ? (
            <p className="text-sm text-muted-foreground">
              No available workers with status &quot;available&quot;. Add or free up workers first.
            </p>
          ) : (
            <div className="space-y-3">
              {jobHasRequirements &&
                rankedWorkers.length === 0 &&
                workersNoRequiredSkillMatch.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  No workers match any required skill yet — you can still assign from the list below.
                </p>
              )}
              <ul
                className="max-h-[min(20rem,45vh)] space-y-2 overflow-y-auto pr-1"
                aria-label="Workers ranked for this job"
              >
                {skillMatchListWorkers.map((w) => (
                  <li key={w.id}>
                    <WorkerCard
                      w={w}
                      selected={selectedWorkerId === w.id}
                      onSelect={setSelectedWorkerId}
                      jobHasRequirements={jobHasRequirements}
                      requiredCount={requiredCount}
                    />
                  </li>
                ))}
              </ul>

              {jobHasRequirements && noSkillMatchListWorkers.length > 0 && (
                <>
                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border/60" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-[var(--glass-bg)] px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        No skill match
                      </span>
                    </div>
                  </div>
                  <ul
                    className="space-y-2 pr-1"
                    aria-label="Closest worker without required skills"
                  >
                    {noSkillMatchListWorkers.map((w) => (
                      <li key={w.id}>
                        <WorkerCard
                          w={w}
                          selected={selectedWorkerId === w.id}
                          onSelect={setSelectedWorkerId}
                          jobHasRequirements={jobHasRequirements}
                          requiredCount={requiredCount}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="flex justify-end border-t border-border/60 pt-4">
            <Button
              variant="default"
              size="lg"
              onClick={handleAssign}
              disabled={!selectedWorkerId || isAssigning || isAutoAssigning || totalRanked === 0}
            >
              {isAssigning ? <Loader2 className="size-4 animate-spin" /> : 'Assign'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
