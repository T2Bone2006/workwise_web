'use client';

import { useState, useTransition, type JSX } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  cancelDirectDebitAction,
  getDirectDebitLinkAction,
  resolveFailedCollectionAction,
  sendDirectDebitInviteAction,
} from '@/lib/actions/direct-debit';
import type { CustomerDirectDebit } from '@/lib/data/direct-debit/customer';
import { formatGbp } from '@/lib/money/pence';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function day(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[date.getUTCDay()]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

function money(amount: number): string {
  return formatGbp(amount, { always2dp: true });
}

type Tone = 'grey' | 'blue' | 'green' | 'amber';
const TONE: Record<Tone, string> = {
  grey: 'bg-muted text-muted-foreground',
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
};

function badgeFor(dd: CustomerDirectDebit): { text: string; tone: Tone } {
  switch (dd.status) {
    case 'setting_up':
      return { text: 'Setting up', tone: 'blue' };
    case 'pending':
      return { text: 'Waiting for their bank (about 3 days)', tone: 'blue' };
    case 'active':
      return { text: dd.bankEnding ? `Active · ••${dd.bankEnding}` : 'Active', tone: 'green' };
    case 'inactive': {
      const reason = (dd.inactiveReason ?? '').toLowerCase();
      if (reason.includes("didn't accept")) return { text: 'Not accepted by their bank', tone: 'amber' };
      if (reason.includes('expired')) return { text: 'Expired', tone: 'amber' };
      return { text: 'Stopped', tone: 'amber' };
    }
    case 'cancelled':
      if (dd.cancelledBy === 'customer') return { text: 'Cancelled by customer', tone: 'grey' };
      if (dd.cancelledBy === 'bank') return { text: 'Stopped by their bank', tone: 'grey' };
      return { text: 'Cancelled', tone: 'grey' };
    default:
      return { text: 'Not set up', tone: 'grey' };
  }
}

const RECENT_LABEL: Record<CustomerDirectDebit['recent'][number]['status'], string> = {
  processing: 'Collecting',
  succeeded: 'Paid',
  failed: 'Failed',
  error: "Didn't reach the bank",
  cancelled: 'Cancelled',
};

export function CustomerDirectDebitSection(props: {
  directDebit: CustomerDirectDebit;
  customerId: string;
  customerName: string;
}): JSX.Element {
  const { directDebit: dd, customerId, customerName } = props;
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const badge = badgeFor(dd);
  const live = dd.status === 'pending' || dd.status === 'active';

  function sendLink() {
    startTransition(async () => {
      const result = await sendDirectDebitInviteAction({ customerId });
      if (!result.ok) toast.error(result.error);
      else toast.success(result.channel === 'email' ? 'Sent by email' : 'Sent by text');
    });
  }

  function copyLink() {
    startTransition(async () => {
      const result = await getDirectDebitLinkAction({ customerId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      try {
        await navigator.clipboard.writeText(result.url);
        toast.success('Link copied');
      } catch {
        // Clipboard blocked: show the link so it can be copied by hand.
        setManualLink(result.url);
      }
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelDirectDebitAction({ customerId });
      setCancelOpen(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.stillCollecting > 0
          ? `Cancelled. ${money(result.stillCollecting)} already being collected may still go through.`
          : 'Cancelled',
      );
    });
  }

  function resolve(collectionId: string, action: 'collect_again' | 'leave') {
    startTransition(async () => {
      const result = await resolveFailedCollectionAction({ collectionId, action });
      if (!result.ok) toast.error(result.error);
      else toast.success(action === 'collect_again' ? 'Collecting again' : 'Left — normal reminders will follow');
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Direct Debit</span>
        <Badge className={TONE[badge.tone]}>{badge.text}</Badge>
      </div>
      {dd.status === 'inactive' && dd.inactiveReason ? (
        <p className="text-xs text-muted-foreground">{dd.inactiveReason}</p>
      ) : null}
      {dd.source === 'imported' && dd.status !== 'not_set_up' ? (
        <p className="text-xs text-muted-foreground">From your existing GoCardless</p>
      ) : null}

      {dd.collecting.amount > 0 ? (
        <p>
          Collecting {money(dd.collecting.amount)} by Direct Debit
          {dd.collecting.expectedOn ? ` — due about ${day(dd.collecting.expectedOn)}` : ''}
        </p>
      ) : null}

      {dd.failed.map((f) => (
        <div key={f.collectionId} className="space-y-2 rounded-md bg-amber-500/10 p-2">
          <p>
            {money(f.amount)} wasn&apos;t collected{f.failedOn ? ` on ${day(f.failedOn)}` : ''} — {f.reason}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => resolve(f.collectionId, 'collect_again')}>
              Collect again
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => resolve(f.collectionId, 'leave')}>
              Leave it
            </Button>
          </div>
        </div>
      ))}

      {!live ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={sendLink}>
            Send Direct Debit link
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={copyLink}>
            Copy link
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          onClick={() => setCancelOpen(true)}
        >
          Cancel Direct Debit
        </button>
      )}
      {manualLink ? (
        <Input readOnly value={manualLink} onFocus={(e) => e.currentTarget.select()} aria-label="Direct Debit link" />
      ) : null}

      {dd.recent.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Recent Direct Debits</summary>
          <ul className="mt-2 space-y-1">
            {dd.recent.map((r) => (
              <li key={r.collectionId}>
                {r.date ? `${day(r.date)} · ` : ''}
                {money(r.amount)} · {RECENT_LABEL[r.status]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Direct Debit?</DialogTitle>
            <DialogDescription>
              Cancel {customerName}&apos;s Direct Debit? WorkWise will stop collecting. They can set it up
              again from their pay page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={pending} onClick={cancel}>
              Cancel Direct Debit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
