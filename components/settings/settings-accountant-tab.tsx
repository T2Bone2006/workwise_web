'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Download, Loader2, Mail, X } from 'lucide-react';
import { TaxYearDownload } from '@/components/downloads/tax-year-download';
import { downloadZip } from '@/lib/downloads/client';
import { toast } from 'sonner';
import {
  inviteAccountantAction,
  removeAccountantAction,
  resendAccountantInviteAction,
} from '@/lib/actions/accountant';
import { MAX_ACCOUNTANTS } from '@/lib/accountant/limits';
import type { AccessSummary } from '@/lib/accountant/access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CAN_SEE = [
  'Money in and out, by month and tax year',
  'Your expenses and receipt photos',
  'Your invoices, as you issued them, and the payments against them',
  'Downloads for your tax return',
];
const CANNOT = [
  'Change anything, or message anyone',
  'See your customer list, phone numbers or notes',
  'See anything after you remove them',
];

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/London',
});

function invitedLine(iso: string): string {
  return `Invited ${dayFormat.format(new Date(iso))}`;
}

function viewedLine(iso: string | null): string {
  if (!iso) return 'Not opened yet';
  const d = new Date(iso);
  return `Last viewed ${dayFormat.format(d)}, ${timeFormat.format(d)}`;
}

function Bullets({ items, icon: Icon, tone }: { items: string[]; icon: typeof Check; tone: string }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function SettingsAccountantTab({
  accountants,
  currentTaxYear,
}: {
  accountants: AccessSummary[] | null;
  /** The tax year we're in (its start year), from the server. */
  currentTaxYear: number;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AccessSummary | null>(null);
  const [exporting, setExporting] = useState(false);

  const list = accountants ?? [];
  const atLimit = list.length >= MAX_ACCOUNTANTS;

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (inviting) return;
    if (email.trim() === '') return setError('Enter your accountant’s email address.');
    setInviting(true);
    setError(null);
    const result = await inviteAccountantAction({ email, name: name.trim() || undefined });
    setInviting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(`We’ve emailed ${email.trim().toLowerCase()} a link.`);
    setEmail('');
    setName('');
    router.refresh();
  };

  const resend = async (a: AccessSummary) => {
    setBusyId(a.id);
    const result = await resendAccountantInviteAction({ accessId: a.id });
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`We’ve emailed ${a.email} a new link. The old link no longer works.`);
    router.refresh();
  };

  const downloadAll = async () => {
    if (exporting) return;
    setExporting(true);
    const result = await downloadZip('/api/downloads/all-data');
    setExporting(false);
    if (result.ok) toast.success('Download ready');
    else toast.error(result.error);
  };

  const remove = async () => {
    if (!removing) return;
    const target = removing;
    setBusyId(target.id);
    const result = await removeAccountantAction({ accessId: target.id });
    setBusyId(null);
    setRemoving(null);
    if (!result.success) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    toast.success(`${target.name ?? target.email} can no longer open your books.`);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your accountant</CardTitle>
          <CardDescription>
            Give your accountant read-only access to your books, so you don’t have to send them anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 rounded-lg bg-muted/50 p-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">They can see</p>
              <Bullets items={CAN_SEE} icon={Check} tone="text-emerald-600" />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">They can’t</p>
              <Bullets items={CANNOT} icon={X} tone="text-muted-foreground" />
            </div>
          </div>

          {accountants == null ? (
            <p className="text-sm text-destructive">Couldn’t load your accountants. Refresh to try again.</p>
          ) : list.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {list.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.name ?? a.email}</p>
                    {a.name ? <p className="truncate text-sm text-muted-foreground">{a.email}</p> : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {invitedLine(a.invitedAt)} ·{' '}
                      <span className={a.lastViewedAt ? undefined : 'text-amber-700 dark:text-amber-400'}>
                        {viewedLine(a.lastViewedAt)}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={busyId === a.id} onClick={() => resend(a)}>
                      {busyId === a.id ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                      Send the link again
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" disabled={busyId === a.id} onClick={() => setRemoving(a)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {atLimit ? (
            <p className="text-sm text-muted-foreground">You can give up to {MAX_ACCOUNTANTS} people access.</p>
          ) : (
            <form onSubmit={invite} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="accountant-email">Their email address</Label>
                  <Input
                    id="accountant-email"
                    type="email"
                    autoComplete="off"
                    placeholder="name@theiraccountants.co.uk"
                    value={email}
                    onChange={(e) => {
                      setError(null);
                      setEmail(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="accountant-name">Their name (optional)</Label>
                  <Input id="accountant-name" autoComplete="off" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                We’ll email them a link. Each time they open it we email them a one-time code, so there’s no password to
                remember. You can remove them any time.
              </p>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={inviting}>
                {inviting ? <Loader2 className="size-4 animate-spin" /> : null} Give access
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>
            Download everything in WorkWise as spreadsheets: yours to keep, whatever happens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div>
              <p className="font-medium">Download all my data</p>
              <p className="text-sm text-muted-foreground">
                Customers, schedules, visits, payments, invoices and expenses, as spreadsheets in one file.
              </p>
            </div>
            <Button variant="outline" disabled={exporting} onClick={downloadAll}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Download
            </Button>
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            <div>
              <p className="font-medium">Download a tax year</p>
              <p className="text-sm text-muted-foreground">
                The year’s spreadsheets, plus every receipt photo and invoice PDF. Handy for your records or your accountant.
              </p>
            </div>
            <TaxYearDownload
              years={Array.from({ length: 4 }, (_, i) => currentTaxYear - i)}
              defaultYear={currentTaxYear}
              actions={[
                {
                  key: 'pack',
                  label: 'Download',
                  url: '/api/downloads/tax-year',
                },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Dialog open={removing != null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name ?? removing?.email}?</DialogTitle>
            <DialogDescription>
              Their link stops working straight away, even if they’re signed in right now. You can give them access
              again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Keep access
            </Button>
            <Button variant="destructive" disabled={busyId != null} onClick={remove}>
              {busyId != null ? <Loader2 className="size-4 animate-spin" /> : null} Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
