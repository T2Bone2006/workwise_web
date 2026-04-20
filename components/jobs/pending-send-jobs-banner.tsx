'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RadioTower } from 'lucide-react';
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
import { cn } from '@/lib/utils';

interface PendingSendJobsBannerProps {
  jobs: PendingSendJobRow[];
  className?: string;
}

export function PendingSendJobsBanner({ jobs, className }: PendingSendJobsBannerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const count = jobs.length;

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
        <DialogContent className="max-w-lg border-border/80">
          <DialogHeader>
            <DialogTitle>Send jobs to workers?</DialogTitle>
            <DialogDescription>
              This will notify each worker via the mobile app and mark these jobs as assigned.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[min(50vh,320px)] space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/40 pb-2 last:border-0 last:pb-0"
              >
                <span className="font-medium text-foreground">
                  {j.reference_number ?? j.id.slice(0, 8)}
                </span>
                <span className="text-muted-foreground">{j.worker_name ?? 'Unknown worker'}</span>
              </li>
            ))}
          </ul>
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
                'Confirm and send'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
