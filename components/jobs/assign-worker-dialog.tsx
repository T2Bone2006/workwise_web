'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserPlus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { assignJob, autoAllocateJob } from '@/lib/actions/jobs';
import { cn } from '@/lib/utils';

interface WorkerOption {
  id: string;
  full_name: string;
}

interface AssignWorkerDialogProps {
  jobId: string;
  workers: WorkerOption[];
  triggerLabel: string;
  currentWorkerId?: string;
}

export function AssignWorkerDialog({
  jobId,
  workers,
  triggerLabel,
  currentWorkerId,
}: AssignWorkerDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);

  async function handleAutoAssign() {
    setIsAutoAssigning(true);
    try {
      const result = await autoAllocateJob(jobId);
      if (result.success) {
        toast.success(
          `Allocated to ${result.workerName} (${result.distance}km away). Send from Jobs when ready.`
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? 'Auto-assignment failed');
      }
    } catch {
      toast.error('Failed to auto-assign');
    } finally {
      setIsAutoAssigning(false);
    }
  }

  async function handleAssign() {
    if (!selectedWorkerId) {
      toast.error('Please select a worker');
      return;
    }
    setIsAssigning(true);
    try {
      const result = await assignJob(jobId, selectedWorkerId, { pendingSend: true });
      if (result.success) {
        toast.success('Worker assigned');
        setOpen(false);
        setSelectedWorkerId('');
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto border-border/80 hover:bg-primary/5 hover:border-primary/30 hover:shadow-[0_0_12px_-2px_var(--glow-primary)]"
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          'max-w-md border-border/80 backdrop-blur-[var(--blur-glass)]',
          'bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]'
        )}
      >
        <DialogHeader>
          <DialogTitle>Assign Worker to Job</DialogTitle>
          <DialogDescription>
            Choose a worker to assign to this job, or use auto-assign to pick one automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Button
            type="button"
            variant="gradient"
            size="lg"
            className="w-full gap-2 shadow-[var(--shadow-btn-glow-value)] hover:shadow-glow-md"
            onClick={handleAutoAssign}
            disabled={isAutoAssigning || isAssigning || workers.length === 0}
          >
            {isAutoAssigning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Auto-assign
          </Button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/60" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[var(--glass-bg)] px-2 text-muted-foreground">
                Or select manually
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Select
              value={selectedWorkerId}
              onValueChange={setSelectedWorkerId}
              disabled={workers.length === 0}
            >
              <SelectTrigger
                className={cn(
                  'w-full border-border/80 bg-background/50 backdrop-blur-sm',
                  'focus:ring-primary/20 focus:border-primary/40'
                )}
              >
                <SelectValue placeholder="Select a worker" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    <span className="flex items-center gap-2">
                      <UserPlus className="size-3.5 text-muted-foreground" />
                      {w.full_name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="gradient"
            className="shadow-[var(--shadow-btn-glow-value)]"
            onClick={handleAssign}
            disabled={!selectedWorkerId || isAssigning || isAutoAssigning}
          >
            {isAssigning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              'Assign'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
