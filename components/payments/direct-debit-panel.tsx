'use client';

import { useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  disconnectGoCardlessAction,
  refreshGoCardlessStatusAction,
} from '@/lib/actions/direct-debit';
import type { PaymentSettings } from '@/lib/data/payments/settings';

const REFRESH_COOLDOWN_MS = 10_000;

const GC_TOASTS: Record<string, { text: string; kind: 'success' | 'error' | 'info' }> = {
  connected: { text: 'GoCardless connected', kind: 'success' },
  cancelled: { text: 'Not connected — you can try again any time', kind: 'info' },
  expired: { text: 'That took too long — press Connect GoCardless again', kind: 'error' },
  taken: {
    text: 'That GoCardless account is already connected to another WorkWise business',
    kind: 'error',
  },
  not_allowed: { text: 'Only the account owner can connect GoCardless', kind: 'error' },
  not_configured: { text: "Direct Debit isn't set up on this server yet", kind: 'error' },
  error: { text: 'Something went wrong connecting GoCardless — try again', kind: 'error' },
};

const HOW_IT_WORKS = [
  "The customer enters their bank details once on GoCardless's page.",
  "It's active in about 3 working days.",
  'Each evening WorkWise collects what they owe (visits marked Done, plus anything owed from before). GoCardless emails them first.',
  "It takes about 3–4 working days to arrive. If it fails, you'll get a ping and can collect again or leave it.",
  'Refunds are done in your GoCardless dashboard; WorkWise notices them.',
];

export function DirectDebitPanel(props: {
  data: PaymentSettings['directDebit'];
  /** GoCardless's verification page (from the server's config). */
  verifyUrl: string | null;
  /** The `gc` return code from the connect flow, if we just came back. */
  gc?: string | null;
}): JSX.Element {
  const { data, verifyUrl, gc } = props;
  const router = useRouter();
  const [busy, setBusy] = useState<'refresh' | 'disconnect' | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const connected = data.state !== 'off';

  async function refresh(quiet = false) {
    setBusy('refresh');
    setCooldown(true);
    window.setTimeout(() => setCooldown(false), REFRESH_COOLDOWN_MS);
    const result = await refreshGoCardlessStatusAction();
    setBusy(null);
    if (!result.ok) {
      if (!quiet) toast.error(result.error);
      return;
    }
    router.refresh();
  }

  // One toast for the connect flow's return code, then tidy the URL. Slightly
  // deferred: a toast fired in the same commit as the page's first render is
  // lost, because sonner's <Toaster> hasn't subscribed yet.
  useEffect(() => {
    if (!gc) return;
    const timer = window.setTimeout(() => {
      const toastFor = GC_TOASTS[gc];
      if (toastFor) {
        if (toastFor.kind === 'success') toast.success(toastFor.text);
        else if (toastFor.kind === 'error') toast.error(toastFor.text);
        else toast(toastFor.text);
      }
      router.replace('/settings?tab=payments');
      if (gc === 'connected') void refresh(true);
    }, 100);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gc]);

  async function disconnect() {
    setBusy('disconnect');
    const result = await disconnectGoCardlessAction();
    setBusy(null);
    setDisconnectOpen(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('GoCardless disconnected');
    router.refresh();
  }

  return (
    <Card className="glass-card border-border/80">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <Landmark className="size-5" />
          Direct Debit
          <span className="text-sm font-normal text-muted-foreground">with GoCardless</span>
          {data.state === 'verifying' ? (
            <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300">Checking</Badge>
          ) : null}
          {data.state === 'needs_details' ? (
            <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-300">Needs details</Badge>
          ) : null}
          {data.state === 'on' ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">On</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!data.configured ? (
          <p>Direct Debit isn&apos;t set up on this server yet.</p>
        ) : (
          <>
            {data.state === 'off' ? (
              <>
                {data.disconnectReason ? (
                  <p className="text-muted-foreground">Disconnected: {data.disconnectReason}.</p>
                ) : null}
                <p>
                  Customers set it up once, then WorkWise collects what they owe after each visit —
                  no chasing. It&apos;s a permission, not a subscription: amounts follow the visits
                  you actually do.
                </p>
                <p className="text-muted-foreground">
                  Uses your own GoCardless account. GoCardless&apos;s fee: 1% + 20p per collection
                  (max £4, plus VAT), charged even if a collection fails. WorkWise adds nothing.
                </p>
                <form action="/api/gocardless/connect" method="post" className="space-y-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="has_account" value="1" className="size-4" />
                    I already use GoCardless (e.g. with Squeegee or CleanerPlanner)
                  </label>
                  <Button type="submit">Connect GoCardless</Button>
                </form>
              </>
            ) : null}

            {data.state === 'verifying' ? (
              <p>
                GoCardless is checking your details. This can take a day or two; nothing to do
                unless they email you.
              </p>
            ) : null}
            {data.state === 'needs_details' ? (
              <p>GoCardless needs a few more details before you can collect.</p>
            ) : null}
            {data.state === 'on' ? (
              <>
                <p>
                  Customers can set up Direct Debit from their pay page, or you can send them a link
                  from their customer page. WorkWise collects each evening.
                </p>
                {data.connectedEmail ? (
                  <p className="text-muted-foreground">Connected: {data.connectedEmail}</p>
                ) : null}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setHowOpen(true)}
                >
                  How it works
                </button>
              </>
            ) : null}

            {data.state === 'needs_details' || data.state === 'verifying' ? (
              <div className="flex flex-wrap gap-2">
                {data.state === 'needs_details' && verifyUrl ? (
                  <Button
                    type="button"
                    onClick={() => {
                      window.location.href = verifyUrl;
                    }}
                  >
                    Continue with GoCardless
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy === 'refresh' || cooldown}
                  onClick={() => void refresh()}
                >
                  Refresh
                </Button>
              </div>
            ) : null}

            {connected && data.existingToLink > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <span>
                  {data.existingToLink} existing Direct Debit{data.existingToLink === 1 ? '' : 's'} to
                  link
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link href="/payments/direct-debits">Link them</Link>
                </Button>
              </div>
            ) : null}

            {connected && data.existingToLink === 0 ? (
              <p className="text-muted-foreground">
                Switching from another app?{' '}
                <Link className="font-medium text-primary hover:underline" href="/payments/direct-debits">
                  Existing Direct Debits
                </Link>
              </p>
            ) : null}

            {connected ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect GoCardless
              </button>
            ) : null}
          </>
        )}
      </CardContent>

      <Dialog open={howOpen} onOpenChange={setHowOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How Direct Debit works</DialogTitle>
          </DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {HOW_IT_WORKS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect GoCardless?</DialogTitle>
            <DialogDescription>
              WorkWise will stop collecting Direct Debits. Your customers&apos; Direct Debits stay in
              GoCardless, and reconnecting picks them up again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDisconnectOpen(false)}>
              Keep connected
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === 'disconnect'}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
