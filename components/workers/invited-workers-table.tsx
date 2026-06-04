'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { revokeWorkerInvite, resendWorkerInvite } from '@/lib/actions/workers';
import type { WorkerInviteRow } from '@/lib/data/worker-invites';
import { WORKER_TYPE_LABELS } from '@/lib/types/worker';
import { cn } from '@/lib/utils';

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export interface InvitedWorkersTableProps {
  invites: WorkerInviteRow[];
}

export function InvitedWorkersTable({ invites }: InvitedWorkersTableProps) {
  const router = useRouter();
  const [revokeTarget, setRevokeTarget] = useState<WorkerInviteRow | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const handleResend = async (inviteId: string) => {
    setResendingId(inviteId);
    const result = await resendWorkerInvite(inviteId);
    setResendingId(null);
    if (result.success) {
      toast.success('Invitation resent');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to resend invitation');
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setIsRevoking(true);
    const result = await revokeWorkerInvite(revokeTarget.inviteId);
    setIsRevoking(false);
    setRevokeTarget(null);
    if (result.success) {
      toast.success('Invitation revoked');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to revoke invitation');
    }
  };

  if (invites.length === 0) {
    return (
      <Card className="glass-card border-border/80">
        <CardContent className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <Mail className="size-7 text-primary" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">No pending invitations</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="glass-card overflow-hidden border-border/80">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => (
                <TableRow key={invite.inviteId}>
                  <TableCell className="font-medium">{invite.worker.full_name}</TableCell>
                  <TableCell>{invite.email}</TableCell>
                  <TableCell>
                    {invite.worker.worker_type
                      ? WORKER_TYPE_LABELS[invite.worker.worker_type]
                      : '—'}
                  </TableCell>
                  <TableCell>{formatDate(invite.createdAt)}</TableCell>
                  <TableCell>{formatDate(invite.expiresAt)}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium',
                        invite.isExpired
                          ? 'border-red-400/60 bg-red-500/10 text-red-700 dark:text-red-400'
                          : 'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      )}
                    >
                      {invite.isExpired ? 'Expired' : 'Pending'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={resendingId === invite.inviteId}
                        onClick={() => handleResend(invite.inviteId)}
                      >
                        {resendingId === invite.inviteId ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        Resend
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setRevokeTarget(invite)}
                      >
                        Revoke
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke invitation</DialogTitle>
            <DialogDescription>
              This will permanently delete {revokeTarget?.worker.full_name}&apos;s invite and
              account. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={isRevoking}>
              {isRevoking ? <Loader2 className="size-4 animate-spin" /> : null}
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
