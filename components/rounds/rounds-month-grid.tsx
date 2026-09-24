'use client';

import Link from 'next/link';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { VisitDayCounts } from '@/lib/data/rounds/visits';
import type { RoundsSettings } from '@/lib/rounds/settings';
import type { Ymd } from '@/lib/rounds/dates';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const poundCompact = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const poundExact = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

function toYmd(date: Date): Ymd {
  return format(date, 'yyyy-MM-dd');
}

function isoWeekdayFromDate(date: Date): number {
  const js = date.getDay(); // 0 Sun
  return js === 0 ? 7 : js;
}

function formatPounds(amount: number): string {
  return Number.isInteger(amount)
    ? poundCompact.format(amount)
    : poundExact.format(amount);
}

function monthTotals(counts: Record<Ymd, VisitDayCounts>) {
  let total = 0;
  let done = 0;
  let skipped = 0;
  let plannedAmount = 0;
  for (const bucket of Object.values(counts)) {
    total += bucket.total;
    done += bucket.done;
    skipped += bucket.skipped;
    plannedAmount += bucket.plannedAmount;
  }
  const actionable = Math.max(0, total - skipped);
  const pctDone = actionable > 0 ? Math.round((done / actionable) * 100) : 0;
  return { total, done, skipped, plannedAmount, pctDone, actionable };
}

function heatStrength(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  // Soft curve so a moderately busy day still reads; clamp 0.12–0.55
  const ratio = Math.min(1, value / max);
  return 0.12 + ratio * 0.43;
}

export function RoundsMonthGrid({
  monthYmd,
  counts,
  settings,
  today,
}: {
  /** Any Ymd in the month being shown. */
  monthYmd: Ymd;
  counts: Record<Ymd, VisitDayCounts>;
  settings: RoundsSettings;
  today: Ymd;
}) {
  const monthDate = parseISO(monthYmd);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const working = new Set(settings.working_days);
  const blackouts = new Set(settings.blackouts);

  const prevMonth = toYmd(addMonths(monthStart, -1));
  const nextMonth = toYmd(addMonths(monthStart, 1));

  const totals = monthTotals(counts);
  const maxAmount = Math.max(
    0,
    ...Object.values(counts).map((c) => c.plannedAmount),
  );
  const maxStops = Math.max(0, ...Object.values(counts).map((c) => c.total));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            {format(monthStart, 'MMMM yyyy')}
          </h2>
          {totals.total > 0 ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {totals.total} stop{totals.total === 1 ? '' : 's'}
              </span>
              {' · '}
              <span className="font-medium tabular-nums text-foreground">
                {formatPounds(totals.plannedAmount)}
              </span>
              {' · '}
              <span className="tabular-nums">{totals.pctDone}% done</span>
              {totals.skipped > 0 ? (
                <span className="text-muted-foreground/80">
                  {' '}
                  · {totals.skipped} skipped
                </span>
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No visits this month yet.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link
              href={`/calendar?view=month&date=${prevMonth}`}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/calendar?view=month&date=${today}`}>Today</Link>
          </Button>
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link
              href={`/calendar?view=month&date=${nextMonth}`}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/80">
        <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
          {WEEKDAYS.map((label) => (
            <div
              key={label}
              className="px-1 py-2 text-center text-[10px] font-medium text-muted-foreground sm:px-2 sm:text-xs"
            >
              <span className="sm:hidden">{label.slice(0, 1)}</span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const ymd = toYmd(day);
            const inMonth = isSameMonth(day, monthStart);
            const isToday = ymd === today;
            const isWorking = working.has(isoWeekdayFromDate(day));
            const isBlackout = blackouts.has(ymd);
            const bucket = counts[ymd];
            const hasWork = Boolean(bucket && bucket.total > 0);
            const actionable = hasWork
              ? Math.max(0, bucket!.total - bucket!.skipped)
              : 0;
            const progress =
              actionable > 0 ? Math.min(1, bucket!.done / actionable) : 0;
            const heat = hasWork
              ? heatStrength(
                  Math.max(bucket!.plannedAmount, bucket!.total * 10),
                  Math.max(maxAmount, maxStops * 10, 1),
                )
              : 0;

            const baseShade = isBlackout
              ? 'bg-amber-500/10'
              : !isWorking
                ? 'bg-muted/40'
                : '';

            return (
              <Link
                key={ymd}
                href={`/calendar?view=day&date=${ymd}`}
                className={cn(
                  'relative min-h-[4.75rem] border-b border-r border-border/40 p-1.5 transition-colors sm:min-h-[6.25rem] sm:p-2',
                  'hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  !inMonth && 'opacity-40',
                  baseShade,
                  isToday && 'ring-1 ring-inset ring-emerald-500/50',
                )}
              >
                {heat > 0 && inMonth ? (
                  <div
                    className="pointer-events-none absolute inset-0 bg-emerald-500"
                    style={{ opacity: heat }}
                    aria-hidden
                  />
                ) : null}

                <div className="relative flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold sm:size-7 sm:text-sm',
                      isToday
                        ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                        : 'text-foreground',
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                  {isBlackout ? (
                    <span className="text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400 sm:text-[10px]">
                      Off
                    </span>
                  ) : null}
                </div>

                {hasWork ? (
                  <div className="relative mt-1.5 space-y-1 sm:mt-2">
                    <p className="text-[10px] font-semibold leading-tight text-foreground sm:text-[11px]">
                      <span className="tabular-nums">{bucket!.total}</span>
                      <span className="font-medium text-muted-foreground">
                        {' '}
                        stop{bucket!.total === 1 ? '' : 's'}
                      </span>
                    </p>
                    <p className="text-[11px] font-semibold tabular-nums leading-tight text-foreground sm:text-xs">
                      {formatPounds(bucket!.plannedAmount)}
                    </p>
                    {actionable > 0 ? (
                      <div
                        className="h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
                        title={`${bucket!.done} of ${actionable} done`}
                      >
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width]',
                            progress >= 1
                              ? 'bg-emerald-500'
                              : progress > 0
                                ? 'bg-emerald-400'
                                : 'bg-transparent',
                          )}
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </div>
                    ) : bucket!.skipped > 0 ? (
                      <p className="text-[10px] text-rose-700/90 dark:text-rose-300/90">
                        All skipped
                      </p>
                    ) : null}
                    {(bucket!.done > 0 || bucket!.skipped > 0) &&
                    actionable > 0 ? (
                      <p className="hidden text-[10px] leading-tight text-muted-foreground sm:block">
                        {bucket!.done > 0 ? `${bucket!.done} done` : null}
                        {bucket!.done > 0 && bucket!.skipped > 0 ? ' · ' : null}
                        {bucket!.skipped > 0
                          ? `${bucket!.skipped} skipped`
                          : null}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Greener cells are busier (£). Progress bar is done vs still to do.
        Shaded / “Off” days are usual days off or bank holidays — shade only,
        not a ban.
      </p>
    </div>
  );
}
