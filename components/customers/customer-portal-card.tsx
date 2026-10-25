'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, Mail, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/look';
import { SectionCard } from '@/components/rounds/overview/shared';
import { RevokeCustomerPortalAccessButton } from '@/components/customers/customers-table';
import {
  inviteCustomerToPortal,
  resendCustomerInvite,
  revokeCustomerInvite,
  type PortalStatus,
} from '@/lib/actions/customers';

export type CustomerPortalCardProps = {
  customerId: string;
  customerName: string;
  email: string | null;
  status: PortalStatus;
  pending: { id: string; email: string | null; createdAt: string; expired: boolean } | null;
};

/**
 * Where a customer stands with the portal, in words, with the one button that moves it on.
 * A refused or failed send stays written on the card until the next try, so it can't be missed.
 */
export function CustomerPortalCard({ customerId, customerName, email, status, pending }: CustomerPortalCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'invite' | 'resend' | 'cancel' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(kind: 'invite' | 'resend' | 'cancel') {
    setBusy(kind);
    setProblem(null);
    try {
      const result =
        kind === 'invite'
          ? await inviteCustomerToPortal(customerId)
          : kind === 'resend' && pending
            ? await resendCustomerInvite(pending.id)
            : pending
              ? await revokeCustomerInvite(pending.id)
              : { success: false as const, error: 'There is no open invitation.' };
      if (!result.success) {
        const message = ('error' in result && result.error) || 'That did not work. Try again.';
        setProblem(message);
        toast.error(message, { duration: 15000 });
        return;
      }
      toast.success(
        kind === 'invite' ? 'Portal invite sent' : kind === 'resend' ? 'Invitation sent again' : 'Invitation cancelled',
      );
      router.refresh();
    } catch {
      const message = 'Something went wrong sending that. Try again.';
      setProblem(message);
      toast.error(message, { duration: 15000 });
    } finally {
      setBusy(null);
    }
  }

  const tag =
    status === 'active' ? (
      <Tag tone="emerald">Has access</Tag>
    ) : status === 'invited' ? (
      <Tag tone="amber">{pending?.expired ? 'Invite ran out' : 'Invited'}</Tag>
    ) : (
      <Tag tone="slate">Not invited</Tag>
    );

  return (
    <SectionCard
      title="Customer portal"
      summary="A login so they can see their own jobs and how each one is getting on."
      aside={tag}
      labelledBy="customer-portal-heading"
    >
      <div className="space-y-3">
        {problem ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-(--tone-rose-solid)/30 bg-(--tone-rose-solid)/10 px-3 py-2.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-(--tone-rose-solid)" aria-hidden="true" />
            <p>{problem}</p>
          </div>
        ) : null}

        {status === 'none' && !email ? (
          <>
            <p className="text-sm text-muted-foreground">
              {customerName} has no email address yet, so there is nowhere to send the invite.
            </p>
            <Button asChild variant="outline" className="w-full justify-center">
              <Link href={`/customers/${customerId}/edit`}>Add an email address</Link>
            </Button>
          </>
        ) : null}

        {status === 'none' && email ? (
          <>
            <p className="text-sm text-muted-foreground">
              Nothing has been sent to {customerName} yet. Saving their email doesn&apos;t invite them: this button does.
              The invite goes to <span className="font-medium text-foreground">{email}</span>.
            </p>
            <Button className="w-full justify-center" onClick={() => void run('invite')} disabled={busy !== null}>
              {busy === 'invite' ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Mail className="mr-2 size-4" />}
              Invite to portal
            </Button>
          </>
        ) : null}

        {status === 'invited' ? (
          <>
            <p className="text-sm text-muted-foreground">
              {pending?.expired ? 'The invitation to ' : 'Invitation sent to '}
              <span className="font-medium text-foreground">{pending?.email ?? email ?? 'their email'}</span>
              {pending?.createdAt ? ` on ${format(new Date(pending.createdAt), 'd MMM')}` : ''}
              {pending?.expired ? ' has run out. Send a new one.' : '. They can see their jobs once they accept it.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button className="flex-1" onClick={() => void run('resend')} disabled={busy !== null}>
                {busy === 'resend' ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Mail className="mr-2 size-4" />}
                Resend invitation
              </Button>
              <Button variant="outline" onClick={() => void run('cancel')} disabled={busy !== null}>
                {busy === 'cancel' ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Cancel invite
              </Button>
            </div>
          </>
        ) : null}

        {status === 'active' ? (
          <>
            <p className="text-sm text-muted-foreground">
              {customerName} can log in to the portal{email ? ` with ${email}` : ''} and see their jobs.
            </p>
            <RevokeCustomerPortalAccessButton customerId={customerId} />
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}
