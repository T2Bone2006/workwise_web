'use client';

import { useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';
import { Loader2, MapPin, RadioTower, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { sendPendingJobsToWorkers } from '@/lib/actions/jobs';
import type { PendingSendJobRow } from '@/lib/data/jobs';
import type { TenantSkillRow } from '@/lib/actions/skills';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PendingSendJobsBannerProps {
  jobs: PendingSendJobRow[];
  /** Skills are configured per tenant — never hardcode a label list. */
  tenantSkills: TenantSkillRow[];
  className?: string;
}

const UNASSIGNED_KEY = '__unassigned__';

/**
 * Imported job descriptions arrive as pipe-delimited key/value strings, e.g.
 * `Cylinder Lock | Contract : EDF | W/O Mobile : 07579 837680 | ...`.
 * The leading segment is the job type; the rest is metadata that would swamp
 * the dialog if shown raw. Manually-created jobs are freeform, so they fall
 * through unchanged.
 */
function parseDescription(description: string | null): {
  jobType: string | null;
  detail: string | null;
} {
  const trimmed = description?.trim();
  if (!trimmed) return { jobType: null, detail: null };

  if (!trimmed.includes('|')) {
    return { jobType: trimmed, detail: null };
  }

  const [first, ...rest] = trimmed.split('|').map((part) => part.trim()).filter(Boolean);
  const jobType = first && first.toLowerCase() !== 'unknown' ? first : null;
  const detail = rest.length > 0 ? rest.join(' · ') : null;
  return { jobType, detail };
}

export function PendingSendJobsBanner({
  jobs,
  tenantSkills,
  className,
}: PendingSendJobsBannerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const count = jobs.length;

  const skillLabel = useMemo(() => {
    const byKey = new Map(tenantSkills.map((s) => [s.key, s.label]));
    return (key: string) => byKey.get(key) ?? key;
  }, [tenantSkills]);

  // Dispatch is worker-centric — a reviewer wants to see who is about to be
  // sent what, not a flat list they have to mentally regroup.
  const groupedByWorker = useMemo(() => {
    const groups = new Map<string, { workerName: string; jobs: PendingSendJobRow[] }>();
    for (const job of jobs) {
      const key = job.worker_name ?? UNASSIGNED_KEY;
      const existing = groups.get(key);
      if (existing) {
        existing.jobs.push(job);
      } else {
        groups.set(key, {
          workerName: job.worker_name ?? 'Unknown worker',
          jobs: [job],
        });
      }
    }
    return [...groups.values()].sort((a, b) => a.workerName.localeCompare(b.workerName));
  }, [jobs]);

  if (count <= 0) return null;

  async function handleConfirm() {
    setConfirming(true);
    try {
      const result = await sendPendingJobsToWorkers();
      if (result.success) {
        toast.success(
          result.sent === count
            ? `Sent ${result.sent} job${result.sent === 1 ? '' : 's'} to workers`
            : `Sent ${result.sent} of ${count} job${count === 1 ? '' : 's'}`
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to send jobs');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-3 shadow-[0_0_24px_-8px_rgba(6,182,212,0.35)]',
          'dark:border-cyan-400/25 dark:bg-cyan-500/5',
          className
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-cyan-500/25 dark:bg-cyan-500/10">
            <RadioTower className="size-5 text-cyan-800 dark:text-cyan-300" />
          </div>
          <div>
            <p className="font-medium text-cyan-950 dark:text-cyan-100">
              {count} job{count === 1 ? '' : 's'} ready to send — Review and send to workers
            </p>
            <p className="text-sm text-cyan-900/90 dark:text-cyan-200/85">
              Workers are assigned but have not been notified in the app yet.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="default"
          size="default"
          className="shrink-0 bg-cyan-600 text-white hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-500"
          onClick={() => setOpen(true)}
        >
          <RadioTower className="size-4" />
          Send out jobs
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl border-border/80">
          <DialogHeader>
            <DialogTitle>Send jobs to workers?</DialogTitle>
            <DialogDescription>
              {count} job{count === 1 ? '' : 's'} across {groupedByWorker.length} worker
              {groupedByWorker.length === 1 ? '' : 's'} will be notified via the mobile app and
              marked as assigned.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[min(65vh,600px)] space-y-4 overflow-y-auto pr-1">
            {groupedByWorker.map((group) => (
              <div key={group.workerName} className="rounded-lg border border-border/60">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <User className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate text-sm font-semibold text-foreground">
                      {group.workerName}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {group.jobs.length} job{group.jobs.length === 1 ? '' : 's'}
                  </span>
                </div>

                <ul className="divide-y divide-border/40">
                  {group.jobs.map((job) => {
                    const { jobType, detail } = parseDescription(job.job_description);
                    const location = [job.address, job.postcode].filter(Boolean).join(', ');
                    return (
                      <li key={job.id} className="space-y-1.5 px-3 py-2.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="font-medium text-foreground">
                            {jobType ?? 'Job'}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {job.reference_number ?? job.id.slice(0, 8)}
                          </span>
                        </div>

                        {location && (
                          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
                            <span className="line-clamp-1">{location}</span>
                          </p>
                        )}

                        {detail && (
                          <p className="line-clamp-1 text-xs text-muted-foreground/80">{detail}</p>
                        )}

                        {job.required_skills.length > 0 ? (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {job.required_skills.map((skill) => (
                              <Badge
                                key={skill}
                                variant="secondary"
                                className="px-1.5 py-0 text-[10px] font-normal"
                              >
                                {skillLabel(skill)}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="pt-0.5 text-[11px] italic text-muted-foreground/70">
                            No skills detected
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={confirming}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={confirming}>
              {confirming ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Sending…
                </>
              ) : (
                `Send ${count} job${count === 1 ? '' : 's'}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
