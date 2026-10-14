'use client';

import { useState } from 'react';
import { Eye, Loader2, MoreHorizontal, Trash2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CancelJobDialog } from '@/components/jobs/cancel-job-form';
import { deleteJob, updateJobStatus } from '@/lib/actions/jobs';
import { canCancelJob } from '@/lib/jobs/cancellation-time';

interface JobRowMenuProps {
  jobId: string;
  reference: string;
  status: string | null;
  onOpen: () => void;
  onCancelled: (iso: string) => void;
}

export function JobRowMenu({ jobId, reference, status, onOpen, onCancelled }: JobRowMenuProps) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState<'cancel' | 'delete' | null>(null);
  const canCancel = canCancelJob(status);
  const canDelete = status !== 'in_progress';

  async function cancel(iso: string) {
    setBusy('cancel');
    try {
      const result = await updateJobStatus(jobId, 'cancelled', { cancelledAt: iso });
      if (result.success) {
        onCancelled(iso);
        toast.success('Job cancelled');
        setCancelOpen(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to cancel job');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      const result = await deleteJob(jobId);
      if (result.success) {
        toast.success('Job deleted');
        setDeleteOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? 'Failed to delete job');
      }
    } catch {
      toast.error('Failed to delete job');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Actions for ${reference}`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onSelect={() => {
              window.setTimeout(onOpen, 0);
            }}
          >
            <Eye />
            View
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {canCancel ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                window.setTimeout(() => setCancelOpen(true), 0);
              }}
            >
              <XCircle />
              Cancel job
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            disabled={!canDelete}
            onSelect={() => {
              window.setTimeout(() => setDeleteOpen(true), 0);
            }}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CancelJobDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        busy={busy === 'cancel'}
        onSubmit={(iso) => void cancel(iso)}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete job</DialogTitle>
            <DialogDescription>
              Delete {reference}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={busy === 'delete'}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void remove()}
              disabled={busy === 'delete'}
            >
              {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
