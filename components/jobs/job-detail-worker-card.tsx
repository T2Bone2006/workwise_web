'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, Phone, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { assignJob, autoAllocateJob } from '@/lib/actions/jobs';
import type { JobStatus } from '@/lib/data/jobs';
import { cn } from '@/lib/utils';

interface WorkerOption {
  id: string;
  full_name: string;
}

interface JobDetailWorkerCardProps {
  jobId: string;
  status: JobStatus;
  worker: { id: string; full_name: string; phone: string | null } | null;
  workers: WorkerOption[];
}

const EDITABLE_STATUSES: readonly JobStatus[] = ['pending', 'pending_send'];

function canEditWorkerAssignment(status: JobStatus) {
  return EDITABLE_STATUSES.includes(status);
}

export function JobDetailWorkerCard({
  jobId,
  status,
  worker,
  workers,
}: JobDetailWorkerCardProps) {
  const router = useRouter();
  const [isAssigning, setIsAssigning] = useState(false);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);

  const editable = canEditWorkerAssignment(status);

  async function handleWorkerChange(workerId: string) {
    if (workerId === worker?.id) return;
    setIsAssigning(true);
    try {
      const result = await assignJob(jobId, workerId, { pendingSend: true });
      if (result.success) {
        toast.success(
          worker ? 'Worker updated' : 'Worker assigned — send from Jobs when ready.'
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to update worker');
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleAutoAssign() {
    setIsAutoAssigning(true);
    try {
      const result = await autoAllocateJob(jobId);
      if (result.success) {
        toast.success(
          `Allocated to ${result.workerName} (${result.distance}km away). Send from Jobs when ready.`
        );
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

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Assignment</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {editable ? (
          <>
            <div className="space-y-2">
              <label htmlFor={`assign-worker-${jobId}`} className="sr-only">
                Assigned worker
              </label>
              <Select
                value={worker?.id}
                onValueChange={handleWorkerChange}
                disabled={isAssigning || workers.length === 0}
              >
                <SelectTrigger
                  id={`assign-worker-${jobId}`}
                  className={cn(
                    'w-full border-border/80 bg-background/50 backdrop-blur-sm',
                    'focus:ring-primary/20 focus:border-primary/40'
                  )}
                  aria-label={worker ? 'Change assigned worker' : 'Assign worker'}
                >
                  <SelectValue placeholder="Assign worker" />
                </SelectTrigger>
                <SelectContent>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAssigning && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Updating…
                </p>
              )}
              {workers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No workers available — add workers in the Workers section first.
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2 border-border/80 sm:w-auto"
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
            {worker?.phone && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
                <Phone className="size-4 shrink-0" />
                <a href={`tel:${worker.phone}`} className="text-primary hover:underline">
                  {worker.phone}
                </a>
              </div>
            )}
          </>
        ) : (
          <>
            {worker ? (
              <>
                <div className="flex items-center gap-2">
                  <User className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-foreground">{worker.full_name}</span>
                </div>
                {worker.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="size-4 shrink-0" />
                    <a href={`tel:${worker.phone}`} className="text-primary hover:underline">
                      {worker.phone}
                    </a>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Unassigned</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
