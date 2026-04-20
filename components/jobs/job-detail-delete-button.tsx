'use client';

import { useState } from 'react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { deleteJob } from '@/lib/actions/jobs';
import type { JobStatus } from '@/lib/data/jobs';

interface JobDetailDeleteButtonProps {
  jobId: string;
  status: JobStatus;
}

export function JobDetailDeleteButton({ jobId, status }: JobDetailDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const canDelete = status !== 'in_progress';

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteJob(jobId);
    setIsDeleting(false);
    setOpen(false);
    if (result.success) {
      toast.success('Job deleted');
      router.push('/jobs');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete job');
    }
  };

  const trigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0 gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      disabled={!canDelete}
      onClick={() => canDelete && setOpen(true)}
    >
      <Trash2 className="size-4" />
      Delete job
    </Button>
  );

  return (
    <TooltipProvider>
      {!canDelete ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-left">
            Cannot delete a job while it is in progress. Complete the job or change its status first.
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete job</DialogTitle>
            <DialogDescription>
              Are you sure? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
