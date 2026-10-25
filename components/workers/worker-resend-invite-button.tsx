'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { resendWorkerInvite } from '@/lib/actions/workers';

export function WorkerResendInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const result = await resendWorkerInvite(inviteId);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to resend invitation');
        return;
      }
      toast.success('Invitation sent again');
      router.refresh();
    } catch {
      toast.error('Failed to resend invitation');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={isPending}>
      {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Mail className="mr-2 size-4" />}
      Resend invite
    </Button>
  );
}
