'use client';

import { useState, useTransition } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { resetWorkerPassword } from '@/lib/actions/workers';

interface WorkerPasswordResetButtonProps {
  email: string;
}

export function WorkerPasswordResetButton({ email }: WorkerPasswordResetButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function handleClick() {
    startTransition(async () => {
      const result = await resetWorkerPassword(email);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to send password reset');
        return;
      }
      setSent(true);
      toast.success('Password reset email sent');
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-start"
      onClick={handleClick}
      disabled={isPending || sent}
    >
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <KeyRound className="mr-2 h-4 w-4" />
      )}
      {sent ? 'Reset Email Sent' : 'Send Password Reset'}
    </Button>
  );
}
