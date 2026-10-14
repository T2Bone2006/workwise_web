'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DIALOG_SHEET } from './team-ui';

/** A plain "are you sure" that says what will happen and names the buttons by their action. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  keepLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  keepLabel: string;
  /** Resolve with an error message to show, or null when it worked (the dialog then closes). */
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const message = await onConfirm();
    setPending(false);
    if (message) setError(message);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent className={DIALOG_SHEET}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {keepLabel}
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
