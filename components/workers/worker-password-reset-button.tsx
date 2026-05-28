'use client';

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { requestWorkerPasswordReset } from '@/lib/actions/auth';

interface WorkerPasswordResetButtonProps {
  workerId: string;
}

export function WorkerPasswordResetButton({ workerId }: WorkerPasswordResetButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const result = await requestWorkerPasswordReset(workerId);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to send password reset');
        return;
      }
      setSent(true);
      toast.success('Password reset email sent');
    } catch {
      toast.error('Failed to send password reset');
    } finally {
      setIsPending(false);
    }
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
