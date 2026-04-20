'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  UserPlus,
  Play,
  CheckCircle,
  XCircle,
  RotateCcw,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateJobStatus, sendJobToWorker } from '@/lib/actions/jobs';
import { cn } from '@/lib/utils';
import type { JobStatus } from '@/lib/data/jobs';

interface JobDetailActionsCardProps {
  jobId: string;
  status: JobStatus;
  hasWorker: boolean;
}

export function JobDetailActionsCard({
  jobId,
  status,
  hasWorker,
}: JobDetailActionsCardProps) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  async function handleStatusChange(newStatus: string) {
    setLoadingAction(newStatus);
    try {
      const result = await updateJobStatus(jobId, newStatus);
      if (result.success) {
        toast.success('Status updated');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to update status');
    } finally {
      setLoadingAction(null);
      setCancelConfirmOpen(false);
    }
  }

  const isPending = status === 'pending';
  const isPendingSend = status === 'pending_send' && hasWorker;
  const isAssigned = status === 'assigned';
  const isInProgress = status === 'in_progress';
  const isCompleted = status === 'completed';
  const isCancelled = status === 'cancelled';

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Actions</h2>
      </CardHeader>
      <CardContent className="space-y-2">
        {isPending && (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Assign a worker first, or cancel the job.
            </p>
            <Button
              variant="outline"
              size="default"
              className="w-full gap-2 border-border/80 hover:bg-primary/5 hover:border-primary/30"
              asChild
            >
              <a href="#assignment">
                <UserPlus className="size-4" />
                Assign Worker
              </a>
            </Button>
            <Button
              variant="destructive"
              size="default"
              className="w-full gap-2"
              onClick={() => setCancelConfirmOpen(true)}
            >
              <XCircle className="size-4" />
              Cancel Job
            </Button>
          </>
        )}
        {isPendingSend && (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              The worker is assigned but has not been notified in the app yet. Send when you are ready.
            </p>
            <Button
              variant="gradient"
              size="default"
              className="w-full gap-2 shadow-[var(--shadow-btn-glow-value)] hover:shadow-glow-md"
              onClick={async () => {
                setLoadingAction('send');
                try {
                  const result = await sendJobToWorker(jobId);
                  if (result.success) {
                    toast.success('Sent to worker');
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                } catch {
                  toast.error('Failed to send');
                } finally {
                  setLoadingAction(null);
                }
              }}
              disabled={!!loadingAction}
            >
              {loadingAction === 'send' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send to worker
            </Button>
            <Button
              variant="destructive"
              size="default"
              className="w-full gap-2"
              onClick={() => setCancelConfirmOpen(true)}
              disabled={!!loadingAction}
            >
              <XCircle className="size-4" />
              Cancel Job
            </Button>
          </>
        )}
        {isAssigned && (
          <>
            <Button
              variant="gradient"
              size="default"
              className="w-full gap-2 shadow-[var(--shadow-btn-glow-value)] hover:shadow-glow-md"
              onClick={() => handleStatusChange('in_progress')}
              disabled={!!loadingAction}
            >
              {loadingAction === 'in_progress' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Start Work
            </Button>
            <Button
              variant="destructive"
              size="default"
              className="w-full gap-2"
              onClick={() => setCancelConfirmOpen(true)}
              disabled={!!loadingAction}
            >
              <XCircle className="size-4" />
              Cancel Job
            </Button>
          </>
        )}
        {isInProgress && (
          <>
            <Button
              variant="gradient"
              size="default"
              className="w-full gap-2 shadow-[var(--shadow-btn-glow-value)] hover:shadow-glow-md"
              onClick={() => handleStatusChange('completed')}
              disabled={!!loadingAction}
            >
              {loadingAction === 'completed' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle className="size-4" />
              )}
              Mark Complete
            </Button>
            <Button
              variant="destructive"
              size="default"
              className="w-full gap-2"
              onClick={() => setCancelConfirmOpen(true)}
              disabled={!!loadingAction}
            >
              <XCircle className="size-4" />
              Cancel Job
            </Button>
          </>
        )}
        {isCompleted && (
          <Button
            variant="outline"
            size="default"
            className="w-full gap-2 border-border/80 hover:bg-primary/5"
            onClick={() => handleStatusChange('assigned')}
            disabled={!!loadingAction}
          >
            {loadingAction === 'assigned' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Reopen Job
          </Button>
        )}
        {isCancelled && (
          <p className="text-sm text-muted-foreground">This job is cancelled.</p>
        )}
      </CardContent>

      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent
          className={cn(
            'max-w-sm border-border/80 backdrop-blur-[var(--blur-glass)]',
            'bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          <DialogHeader>
            <DialogTitle>Cancel job?</DialogTitle>
            <DialogDescription>
              This will mark the job as cancelled. You can reopen it later from the job list if needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setCancelConfirmOpen(false)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleStatusChange('cancelled')}
              disabled={!!loadingAction}
            >
              {loadingAction === 'cancelled' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Cancel job'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
