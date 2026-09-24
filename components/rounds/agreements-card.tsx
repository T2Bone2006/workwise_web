'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { CalendarIcon, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  endAgreement,
  pauseAgreement,
  resumeAgreement,
} from '@/lib/actions/rounds/agreements';
import type { AgreementListRow } from '@/lib/data/rounds/agreements';
import { frequencyLabel } from '@/lib/rounds/parse-frequency';
import type { Ymd } from '@/lib/rounds/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const priceFormat = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

function formatYmdDisplay(ymd: string | null): string {
  if (!ymd) return '—';
  try {
    return format(parseISO(ymd), 'd MMM yyyy');
  } catch {
    return ymd;
  }
}

function toYmd(date: Date): Ymd {
  return format(date, 'yyyy-MM-dd');
}

function statusBadge(status: AgreementListRow['status']) {
  if (status === 'active') {
    return <Badge variant="secondary">Active</Badge>;
  }
  if (status === 'paused') {
    return <Badge variant="outline">Paused</Badge>;
  }
  return <Badge variant="outline">Ended</Badge>;
}

function scheduleLabel(agreement: AgreementListRow): string {
  const freq = frequencyLabel(agreement.frequency_days);
  const mode =
    agreement.schedule_mode === 'after_completion'
      ? 'from last visit'
      : 'fixed dates';
  const weekday =
    agreement.preferred_weekday != null
      ? WEEKDAY_LABELS[agreement.preferred_weekday] ?? null
      : null;
  const bits = [freq, mode];
  if (weekday) bits.push(weekday);
  return bits.join(' · ');
}

export function AgreementsCard({
  customerId,
  agreements,
  fetchError = null,
}: {
  customerId: string;
  agreements: AgreementListRow[];
  fetchError?: string | null;
}) {
  const router = useRouter();
  const [pauseTarget, setPauseTarget] = useState<AgreementListRow | null>(null);
  const [pauseUntil, setPauseUntil] = useState<Date | undefined>(undefined);
  const [pauseCalendarOpen, setPauseCalendarOpen] = useState(false);
  const [endTarget, setEndTarget] = useState<AgreementListRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const runAction = async (
    id: string,
    action: () => Promise<{ success: true } | { success: false; error: string }>,
    successMessage: string,
  ) => {
    setPendingId(id);
    const result = await action();
    setPendingId(null);
    if (result.success) {
      toast.success(successMessage);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  const handlePause = async (indefinite: boolean) => {
    if (!pauseTarget) return;
    const until = indefinite ? null : pauseUntil ? toYmd(pauseUntil) : null;
    if (!indefinite && !until) {
      toast.error('Pick a date, or pause with no end date.');
      return;
    }
    const id = pauseTarget.id;
    setPauseTarget(null);
    setPauseUntil(undefined);
    await runAction(
      id,
      () => pauseAgreement(id, until),
      until ? `Paused until ${formatYmdDisplay(until)}` : 'Agreement paused',
    );
  };

  const handleEnd = async () => {
    if (!endTarget) return;
    const id = endTarget.id;
    setEndTarget(null);
    await runAction(id, () => endAgreement(id), 'Agreement ended');
  };

  return (
    <>
      <Card className="glass-card border-border/80">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <h2 className="text-lg font-semibold">Agreements</h2>
          <Button size="sm" asChild>
            <Link href={`/customers/${customerId}/agreements/new`}>
              <Plus className="mr-1.5 size-4" />
              New agreement
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {fetchError ? (
            <p className="text-sm text-destructive">{fetchError}</p>
          ) : null}

          {agreements.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">No agreements yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a service — address, price, and how often — to start planning visits.
              </p>
              <Button className="mt-4" size="sm" asChild>
                <Link href={`/customers/${customerId}/agreements/new?first=1`}>
                  Add first service
                </Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {agreements.map((agreement) => {
                const busy = pendingId === agreement.id;
                const canEdit = agreement.status !== 'ended';
                return (
                  <li
                    key={agreement.id}
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{agreement.title}</p>
                        {statusBadge(agreement.status)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {[agreement.address, agreement.postcode].filter(Boolean).join(', ')}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {priceFormat.format(agreement.price)} · {scheduleLabel(agreement)}
                        {agreement.service_name
                          ? ` · ${agreement.service_name}`
                          : null}
                      </p>
                      {agreement.status === 'paused' && agreement.paused_until ? (
                        <p className="text-xs text-muted-foreground">
                          Until {formatYmdDisplay(agreement.paused_until)}
                        </p>
                      ) : null}
                      {agreement.status === 'ended' && agreement.ended_at ? (
                        <p className="text-xs text-muted-foreground">
                          Ended {format(parseISO(agreement.ended_at), 'd MMM yyyy')}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {canEdit ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            href={`/customers/${customerId}/agreements/${agreement.id}/edit`}
                          >
                            Edit
                          </Link>
                        </Button>
                      ) : null}
                      {agreement.status === 'active' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setPauseUntil(undefined);
                            setPauseTarget(agreement);
                          }}
                        >
                          {busy ? <Loader2 className="size-4 animate-spin" /> : 'Pause'}
                        </Button>
                      ) : null}
                      {agreement.status === 'paused' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            runAction(
                              agreement.id,
                              () => resumeAgreement(agreement.id),
                              'Agreement resumed',
                            )
                          }
                        >
                          {busy ? <Loader2 className="size-4 animate-spin" /> : 'Resume'}
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={busy}
                          onClick={() => setEndTarget(agreement)}
                        >
                          End
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={pauseTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setPauseTarget(null);
            setPauseUntil(undefined);
            setPauseCalendarOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pause agreement</DialogTitle>
            <DialogDescription>
              Upcoming visits are cleared while paused. Resume when you want them
              planned again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Optional end date</p>
            <Popover open={pauseCalendarOpen} onOpenChange={setPauseCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    'w-full justify-start gap-2 font-normal',
                    !pauseUntil && 'text-muted-foreground',
                  )}
                >
                  <CalendarIcon className="size-4" />
                  {pauseUntil
                    ? format(pauseUntil, 'EEE d MMM yyyy')
                    : 'No end date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={pauseUntil}
                  onSelect={(d) => {
                    setPauseUntil(d);
                    setPauseCalendarOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPauseTarget(null)}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => handlePause(true)}>
              Pause indefinitely
            </Button>
            <Button onClick={() => handlePause(false)} disabled={!pauseUntil}>
              Pause until date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={endTarget != null}
        onOpenChange={(open) => {
          if (!open) setEndTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End agreement</DialogTitle>
            <DialogDescription>
              This stops future visits for{' '}
              <span className="font-medium text-foreground">
                {endTarget?.title}
              </span>
              . Done and skipped history stays. You cannot undo this from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEndTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleEnd}>
              End agreement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
