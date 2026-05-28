'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserMinus, Loader2 } from 'lucide-react';
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
import {
  deactivateWorker,
  getWorkerActiveJobCount,
} from '@/lib/actions/workers';

interface WorkerDeactivateButtonProps {
  workerId: string;
  workerName: string;
  fullWidth?: boolean;
}

export function WorkerDeactivateButton({
  workerId,
  workerName,
  fullWidth = false,
}: WorkerDeactivateButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (open) {
      getWorkerActiveJobCount(workerId).then(setActiveJobCount);
    }
  }, [open, workerId]);

  const handleConfirm = async () => {
    setIsPending(true);
    const result = await deactivateWorker(workerId);
    setIsPending(false);
    setOpen(false);
    if (result.success) {
      toast.success('Worker deactivated');
      if (fullWidth) {
        router.refresh();
      } else {
        router.push('/workers');
        router.refresh();
      }
    } else {
      toast.error(result.error ?? 'Failed to deactivate worker');
    }
  };

  const hasActiveJobs = (activeJobCount ?? 0) > 0;
  const ActionIcon = UserMinus;
  const actionLabel = 'Deactivate worker';
  const confirmLabel = 'Deactivate';

  const buttonClassName = fullWidth
    ? 'w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive'
    : 'text-destructive hover:bg-destructive/10 hover:text-destructive';

  return (
    <>
      <Button
        type="button"
        variant={fullWidth ? 'outline' : 'ghost'}
        className={buttonClassName}
        onClick={() => setOpen(true)}
      >
        <ActionIcon className={fullWidth ? 'mr-2 h-4 w-4' : 'size-4'} />
        {actionLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate worker</DialogTitle>
            <DialogDescription>
              This will disable {workerName}&apos;s access. Their job history
              will be preserved. You can reactivate them at any time.
              {activeJobCount !== null && hasActiveJobs && (
                <span className="mt-2 block font-medium text-destructive">
                  This worker has {activeJobCount} active job(s). Reassign or
                  complete them first.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isPending || hasActiveJobs}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const WorkerDeleteButton = WorkerDeactivateButton;
