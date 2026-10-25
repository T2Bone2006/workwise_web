'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/look';
import { inviteCustomerToPortal, resendCustomerInvite, type PortalStatus } from '@/lib/actions/customers';

export type PortalCellState = { status: PortalStatus; inviteId: string | null };

/** The Portal column in the customers list: where they stand, and a one-click invite when they aren't. */
export function CustomerPortalCell({
  customerId,
  hasEmail,
  state,
}: {
  customerId: string;
  hasEmail: boolean;
  state: PortalCellState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const result =
        state.status === 'invited' && state.inviteId
          ? await resendCustomerInvite(state.inviteId)
          : await inviteCustomerToPortal(customerId);
      if (!result.success) {
        toast.error(result.error ?? 'The invite did not send', { duration: 15000 });
        return;
      }
      toast.success(state.status === 'invited' ? 'Invitation sent again' : 'Portal invite sent');
      router.refresh();
    } catch {
      toast.error('Something went wrong sending that. Try again.', { duration: 15000 });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'active') return <Tag tone="emerald">Has access</Tag>;

  if (state.status === 'none' && !hasEmail) {
    return <span className="text-xs text-muted-foreground">Add an email first</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <Tag tone={state.status === 'invited' ? 'amber' : 'slate'}>{state.status === 'invited' ? 'Invited' : 'Not invited'}</Tag>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2.5 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          void send();
        }}
        disabled={busy}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : state.status === 'invited' ? 'Resend' : 'Invite'}
      </Button>
    </div>
  );
}
