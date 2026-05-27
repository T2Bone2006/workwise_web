'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, UserMinus, Loader2 } from 'lucide-react';
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
  deleteWorker,
  deactivateWorker,
  getWorkerActiveJobCount,
} from '@/lib/actions/workers';

interface WorkerDeleteButtonProps {
  workerId: string;
  workerName: string;
  user_id: string | null;
  fullWidth?: boolean;
}

export function WorkerDeleteButton({
  workerId,
  workerName,
  user_id,
  fullWidth = false,
}: WorkerDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  const isDeactivate = user_id != null;

  useEffect(() => {
    if (open) {
      getWorkerActiveJobCount(workerId).then(setActiveJobCount);
    }
  }, [open, workerId]);

  const handleConfirm = async () => {
    setIsPending(true);
    const result = isDeactivate
      ? await deactivateWorker(workerId)
      : await deleteWorker(workerId);
    setIsPending(false);
    setOpen(false);
    if (result.success) {
      toast.success(isDeactivate ? 'Worker deactivated' : 'Worker deleted');
      if (fullWidth && isDeactivate) {
        router.refresh();
      } else {
        router.push('/workers');
        router.refresh();
      }
    } else {
      toast.error(
        result.error ??
          (isDeactivate ? 'Failed to deactivate worker' : 'Failed to delete worker')
      );
    }
  };

  const hasActiveJobs = (activeJobCount ?? 0) > 0;
  const ActionIcon = isDeactivate ? UserMinus : Trash2;
  const actionLabel = isDeactivate ? 'Deactivate worker' : 'Delete worker';
  const confirmLabel = isDeactivate ? 'Deactivate' : 'Delete';

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
            <DialogTitle>
              {isDeactivate ? 'Deactivate worker' : 'Delete worker'}
            </DialogTitle>
            <DialogDescription>
              {isDeactivate ? (
                <>
                  This will disable {workerName}&apos;s access. Their job history
                  will be preserved. You can reactivate them at any time.
                </>
              ) : (
                <>Are you sure you want to delete {workerName}?</>
              )}
              {activeJobCount !== null && hasActiveJobs && (
                <span className="mt-2 block font-medium text-destructive">
                  {isDeactivate
                    ? `This worker has ${activeJobCount} active job(s). Reassign or complete them first.`
                    : `This worker has ${activeJobCount} active job(s). Reassign jobs first before deleting.`}
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
