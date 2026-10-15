'use client';

import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  assertCancellationInstant,
  cancellationIsoFromParts,
  defaultCancellationParts,
} from '@/lib/jobs/cancellation-time';

interface CancelJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onSubmit: (iso: string) => void;
}

export function CancelJobDialog({
  open,
  onOpenChange,
  busy = false,
  onSubmit,
}: CancelJobDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <CancelJobFields busy={busy} onClose={() => onOpenChange(false)} onSubmit={onSubmit} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CancelJobFields({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (iso: string) => void;
}) {
  const dateId = useId();
  const timeId = useId();
  const [parts, setParts] = useState(defaultCancellationParts);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const iso = cancellationIsoFromParts(parts.date, parts.time);
    if (!iso) {
      setError('Choose a cancellation date and time.');
      return;
    }
    const checked = assertCancellationInstant(iso);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    onSubmit(checked.iso);
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>Cancel job</DialogTitle>
          <DialogDescription>
            Choose the date and time it was cancelled. That time is saved on the job and shown in the list.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={dateId}>Date</Label>
            <Input
              id={dateId}
              type="date"
              value={parts.date}
              disabled={busy}
              className="w-full"
              onChange={(e) => setParts((prev) => ({ ...prev, date: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={timeId}>Time</Label>
            <Input
              id={timeId}
              type="time"
              value={parts.time}
              disabled={busy}
              className="w-full"
              onChange={(e) => setParts((prev) => ({ ...prev, time: e.target.value }))}
              required
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Keep job
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : 'Cancel job'}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}
