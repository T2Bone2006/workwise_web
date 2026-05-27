'use client';

import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createBrowserClient } from '@/lib/supabase/client';

interface WorkerPasswordResetButtonProps {
  email: string;
}

export function WorkerPasswordResetButton({ email }: WorkerPasswordResetButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleClick() {
    setIsPending(true);
    const supabase = createBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo:
        'https://app.joinworkwise.com/auth/callback?next=/reset-password',
    });
    setIsPending(false);

    if (error) {
      toast.error(error.message ?? 'Failed to send password reset');
      return;
    }

    setSent(true);
    toast.success('Password reset email sent');
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
