'use client';

import { useState } from 'react';

import { RadioTower } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingSendJobRow } from '@/lib/data/jobs';
import type { TenantSkillRow } from '@/lib/actions/skills';
import { cn } from '@/lib/utils';
import { SendOutJobsDialog } from '@/components/jobs/send-out-jobs-dialog';

interface PendingSendJobsBannerProps {
  jobs: PendingSendJobRow[];
  /** Skills are configured per tenant — never hardcode a label list. */
  tenantSkills: TenantSkillRow[];
  className?: string;
}

export function PendingSendJobsBanner({
  jobs,
  tenantSkills,
  className,
}: PendingSendJobsBannerProps) {
  const [open, setOpen] = useState(false);
  const count = jobs.length;

  if (count <= 0) return null;

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 backdrop-blur-sm',
          'border-border/70 bg-gradient-to-br from-cyan-100/95 via-sky-50/85 to-cyan-100/80',
          'shadow-[0_1px_0_rgba(6,182,212,0.12),0_10px_28px_-14px_rgba(6,182,212,0.28)]',
          'dark:border-white/[0.08] dark:from-cyan-950/50 dark:via-background dark:to-sky-950/25 dark:shadow-none',
          className
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-cyan-500/15 backdrop-blur-sm dark:border-white/10 dark:bg-cyan-500/10">
            <RadioTower className="size-5 text-cyan-800 dark:text-cyan-300" />
          </div>
          <div>
            <p className="font-medium text-cyan-950 dark:text-cyan-100">
              {count} job{count === 1 ? '' : 's'} ready to send
            </p>
            <p className="text-sm text-cyan-900/80 dark:text-cyan-200/75">
              Workers are assigned but have not been notified in the app yet.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="default"
          size="default"
          className="shrink-0 border border-cyan-500/30 bg-cyan-600/90 text-white shadow-sm backdrop-blur-sm hover:bg-cyan-700 dark:bg-cyan-600/80 dark:hover:bg-cyan-500"
          onClick={() => setOpen(true)}
        >
          <RadioTower className="size-4" />
          Send out jobs
        </Button>
      </div>

      <SendOutJobsDialog open={open} onOpenChange={setOpen} jobs={jobs} tenantSkills={tenantSkills} />
    </>
  );
}
