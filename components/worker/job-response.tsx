'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { acceptJobAction, declineJobAction } from '@/lib/actions/worker/respond';
import { DECLINE_REASON_MAX } from '@/lib/worker/respond';
import { cn } from '@/lib/utils';

/**
 * Accept and Decline for a job that is waiting for the worker's answer. Accept is one tap. Decline asks first
 * (it hands the job back and cannot be undone) and takes an optional reason for the office, as the phone does.
 */
export function JobResponse({
  jobId,
  jobTitle,
  employerName,
  goToAfterDecline,
  className,
}: {
  jobId: string;
  jobTitle: string;
  employerName: string | null;
  /** Where to go once declined (the job page sends them back to the list). Stay put when not set. */
  goToAfterDecline?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const accept = () => {
    if (pending) return;
    setBusy('accept');
    startTransition(async () => {
      const result = await acceptJobAction(jobId);
      setBusy(null);
      if (result.ok) {
        floatingMessage({ title: 'Job accepted', body: 'It is on your calendar. Start it in the WorkWise app on the day.' });
      } else {
        floatingMessage({ title: "Couldn't accept that job", body: result.error, tone: 'error' });
        router.refresh();
      }
    });
  };

  const decline = () => {
    if (pending) return;
    setError(null);
    setBusy('decline');
    startTransition(async () => {
      const result = await declineJobAction(jobId, reason);
      setBusy(null);
      if (result.ok) {
        setAsking(false);
        setReason('');
        floatingMessage({ title: 'Job declined', body: `It goes back to ${employerName ?? 'the office'}.` });
        if (goToAfterDecline) router.push(goToAfterDecline);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <>
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        <Button onClick={accept} disabled={pending} className="h-11 min-w-28 flex-1 sm:flex-none">
          {busy === 'accept' ? <Loader2 className="animate-spin" /> : <Check />}
          Accept
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setError(null);
            setAsking(true);
          }}
          disabled={pending}
          className="h-11 min-w-28 flex-1 sm:flex-none"
        >
          <X />
          Decline
        </Button>
      </div>

      <Dialog open={asking} onOpenChange={(open) => (!pending ? setAsking(open) : undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Decline this job?</DialogTitle>
            <DialogDescription>
              {jobTitle}. It goes back to {employerName ?? 'the office'} to give to someone else. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={`decline-${jobId}`} className="text-sm font-medium">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id={`decline-${jobId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={DECLINE_REASON_MAX}
              rows={3}
              placeholder="So they know why, for example that you are away that day"
            />
            {error ? (
              <p role="alert" className="text-sm text-(--tone-rose-text)">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setAsking(false)} disabled={pending}>
              Keep the job
            </Button>
            <Button variant="destructive" onClick={decline} disabled={pending}>
              {busy === 'decline' ? <Loader2 className="animate-spin" /> : null}
              Decline job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
