'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2 } from 'lucide-react';
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
import { deleteWorker, getWorkerActiveJobCount } from '@/lib/actions/workers';

interface WorkerDeleteButtonProps {
  workerId: string;
  workerName: string;
}

export function WorkerDeleteButton({ workerId, workerName }: WorkerDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      getWorkerActiveJobCount(workerId).then(setActiveJobCount);
    }
  }, [open, workerId]);

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteWorker(workerId);
    setIsDeleting(false);
    setOpen(false);
    if (result.success) {
      toast.success('Worker deleted');
      router.push('/workers');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete worker');
    }
  };

  const hasActiveJobs = (activeJobCount ?? 0) > 0;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
        Delete worker
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete worker</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {workerName}?
              {activeJobCount !== null && hasActiveJobs && (
                <span className="block mt-2 text-destructive font-medium">
                  This worker has {activeJobCount} active job(s). Reassign jobs first before deleting.
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
              onClick={handleDelete}
              disabled={isDeleting || hasActiveJobs}
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
