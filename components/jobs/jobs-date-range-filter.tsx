'use client';

import * as React from 'react';
import { CalendarIcon, X } from 'lucide-react';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Filters `scheduled_date` — the day work is on the calendar for, not when
 * the job record was created. Matches `date_from`/`date_to` on JobsFilters,
 * both `yyyy-MM-dd` strings (same convention as job-form's date field).
 */
interface JobsDateRangeFilterProps {
  dateFrom?: string;
  dateTo?: string;
  onChange: (range: { date_from?: string; date_to?: string }) => void;
}

function parseDateOnly(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toDateOnly(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

const PRESETS: Array<{ label: string; range: () => DateRange }> = [
  { label: 'Today', range: () => ({ from: new Date(), to: new Date() }) },
  {
    label: 'This week',
    range: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: endOfWeek(new Date(), { weekStartsOn: 1 }),
    }),
  },
  { label: 'Next 7 days', range: () => ({ from: new Date(), to: addDays(new Date(), 7) }) },
  {
    label: 'This month',
    range: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }),
  },
  { label: 'Last 30 days', range: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
];

export function JobsDateRangeFilter({ dateFrom, dateTo, onChange }: JobsDateRangeFilterProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRange | undefined>(() => ({
    from: parseDateOnly(dateFrom),
    to: parseDateOnly(dateTo),
  }));

  // Re-sync the draft to the committed value whenever the popover opens, so
  // closing without applying doesn't leave a stale edit for next time.
  React.useEffect(() => {
    if (!open) return;
    setDraft({ from: parseDateOnly(dateFrom), to: parseDateOnly(dateTo) });
  }, [open, dateFrom, dateTo]);

  const commit = (range: DateRange | undefined) => {
    onChange({
      date_from: range?.from ? toDateOnly(range.from) : undefined,
      date_to: range?.to ? toDateOnly(range.to) : undefined,
    });
    setOpen(false);
  };

  const hasValue = !!(dateFrom || dateTo);

  const label = React.useMemo(() => {
    const from = parseDateOnly(dateFrom);
    const to = parseDateOnly(dateTo);
    if (from && to) {
      if (from.getTime() === to.getTime()) return format(from, 'd MMM yyyy');
      const sameYear = from.getFullYear() === to.getFullYear();
      return `${format(from, sameYear ? 'd MMM' : 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
    }
    if (from) return `From ${format(from, 'd MMM yyyy')}`;
    if (to) return `Until ${format(to, 'd MMM yyyy')}`;
    return 'Any date';
  }, [dateFrom, dateTo]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]',
            !hasValue && 'text-muted-foreground'
          )}
        >
          <span className="line-clamp-1 flex items-center gap-2">
            <CalendarIcon className="size-4 shrink-0 opacity-60" />
            {label}
          </span>
          {hasValue && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                commit(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                commit(undefined);
              }}
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear date range"
            >
              <X className="size-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto border-border/80 bg-popover/95 p-0 shadow-[var(--shadow-glass-value)] backdrop-blur-[var(--blur-glass)] dark:bg-popover/95"
      >
        <div className="flex flex-wrap gap-1 border-b border-border/60 p-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => commit(preset.range())}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={draft?.from ?? new Date()}
          selected={draft}
          onSelect={setDraft}
          initialFocus
          className="rounded-lg border-0 bg-transparent"
        />
        <div className="flex items-center justify-between gap-2 border-t border-border/60 p-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => commit(undefined)}>
            Clear
          </Button>
          <Button type="button" size="sm" onClick={() => commit(draft)} disabled={!draft?.from}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
