'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { updateWorkerAutoAssign } from '@/lib/actions/workers';

interface WorkerAutoAssignToggleProps {
  workerId: string;
  initialExcluded: boolean;
}

export function WorkerAutoAssignToggle({
  workerId,
  initialExcluded,
}: WorkerAutoAssignToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [excluded, setExcluded] = useState(initialExcluded);

  const onToggle = (nextValue: boolean) => {
    setExcluded(nextValue);
    startTransition(async () => {
      const result = await updateWorkerAutoAssign(workerId, nextValue);
      if (!result.success) {
        setExcluded(!nextValue);
        toast.error(result.error ?? 'Failed to update auto-assign setting');
        return;
      }
      toast.success('Auto-assign setting updated');
      router.refresh();
    });
  };

  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        id="exclude-from-auto-assign"
        checked={excluded}
        onChange={(e) => onToggle(e.target.checked)}
        disabled={isPending}
        className="mt-1 size-4 rounded border-input accent-primary"
      />
      <div className="space-y-0.5">
        <Label
          htmlFor="exclude-from-auto-assign"
          className="cursor-pointer font-medium"
        >
          Exclude from auto-assign
        </Label>
        <p className="text-xs text-muted-foreground">
          Prevent this worker from being selected by auto-assignment.
        </p>
        {isPending && (
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Saving...
          </p>
        )}
      </div>
    </div>
  );
}
