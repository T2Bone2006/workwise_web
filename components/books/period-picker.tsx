'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { currentMonth, periodParam, periodRange, taxYearFor, type Period } from '@/lib/books/periods';
import type { Ymd } from '@/lib/rounds/dates';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type MonthPeriod = Extract<Period, { kind: 'month' }>;

export type PeriodPickerProps = {
  value: Period;
  /** Where the picker goes, e.g. '/expenses?tab=in-out'. `period=` is added. */
  basePath: string;
  earliestTaxYear: number;
  /** London today, from the server, so server and browser agree on "this month". */
  today: Ymd;
};

function shiftMonth(p: MonthPeriod, by: number): MonthPeriod {
  const index = p.year * 12 + (p.month - 1) + by;
  return { kind: 'month', year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function PeriodPicker({ value, basePath, earliestTaxYear, today }: PeriodPickerProps) {
  const router = useRouter();
  const now = currentMonth(today) as MonthPeriod;
  const latestTaxYear = taxYearFor(today);

  const go = (p: Period) => {
    const join = basePath.includes('?') ? '&' : '?';
    router.push(`${basePath}${join}period=${periodParam(p)}`);
  };

  const atCurrent = value.kind === 'month' && value.year === now.year && value.month === now.month;
  const taxYears = Array.from({ length: Math.max(1, latestTaxYear - earliestTaxYear + 1) }, (_, i) => latestTaxYear - i);

  const segment = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1 text-sm font-medium transition-colors',
      active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg bg-muted p-[3px]" role="group" aria-label="Period type">
        <button
          type="button"
          className={segment(value.kind === 'month')}
          onClick={() => value.kind !== 'month' && go(now)}
        >
          Month
        </button>
        <button
          type="button"
          className={segment(value.kind === 'tax_year')}
          onClick={() => value.kind !== 'tax_year' && go({ kind: 'tax_year', startYear: latestTaxYear })}
        >
          Tax year
        </button>
      </div>

      {value.kind === 'month' ? (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => go(shiftMonth(value, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 text-center font-medium">{periodRange(value).label}</span>
          <Button
            size="icon"
            variant="outline"
            aria-label="Next month"
            disabled={atCurrent}
            onClick={() => go(shiftMonth(value, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : (
        <Select
          value={String(value.startYear)}
          onValueChange={(v) => go({ kind: 'tax_year', startYear: Number(v) })}
        >
          <SelectTrigger className="w-44" aria-label="Tax year">
            <SelectValue>{periodRange(value).label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {taxYears.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {periodRange({ kind: 'tax_year', startYear: y }).label}
              </SelectItem>
            ))}
            {!taxYears.includes(value.startYear) ? (
              <SelectItem value={String(value.startYear)}>
                {periodRange(value).label}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
