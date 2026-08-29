'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { sendJobSummaryToRecipient } from '@/lib/actions/job-emails';
import type { JobStatus } from '@/lib/data/jobs';
import { cn } from '@/lib/utils';

/** Only a finished job has something to report. */
const SENDABLE: JobStatus[] = ['completed', 'incomplete', 'declined'];

interface JobDetailEmailCardProps {
  jobId: string;
  status: JobStatus;
  /** Prefilled recipient — the customer's own address when there is one. */
  defaultRecipient: string | null;
}

export function JobDetailEmailCard({
  jobId,
  status,
  defaultRecipient,
}: JobDetailEmailCardProps) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState(defaultRecipient ?? '');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  if (!SENDABLE.includes(status)) {
    return null;
  }

  async function onSend() {
    setSending(true);
    const result = await sendJobSummaryToRecipient({ jobId, recipient, note });
    setSending(false);
    if (result.success) {
      toast.success(`Summary sent to ${recipient}`, { duration: 5000 });
      setNote('');
      setOpen(false);
    } else {
      toast.error(result.error ?? 'Could not send the email', { duration: 8000 });
    }
  }

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Email summary</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Send what happened on this job — the details, the engineer&rsquo;s report and any
          photos — to the customer or anyone who needs to re-plan it.
        </p>
        <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
          <Mail className="mr-2 size-4" />
          Email about this job
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !sending && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Email job summary</DialogTitle>
            <DialogDescription>
              They&rsquo;ll get the job details, the engineer&rsquo;s answers and links to any
              photos. Nothing internal is included.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="job-email-recipient">Send to</Label>
              <Input
                id="job-email-recipient"
                type="email"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="name@example.com"
                disabled={sending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-email-note">Add a note (optional)</Label>
              <Textarea
                id="job-email-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything you want to say above the summary."
                rows={3}
                disabled={sending}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void onSend()} disabled={sending || !recipient}>
              {sending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
