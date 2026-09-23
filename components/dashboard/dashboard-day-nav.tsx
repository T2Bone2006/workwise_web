'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  addDays,
  format,
  isSameDay,
  isValid,
  parseISO,
  subDays,
} from 'date-fns';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function parseDay(value: string | null | undefined): Date {
  if (value) {
    const parsed = parseISO(value);
    if (isValid(parsed)) return parsed;
  }
  return new Date();
}

function toDateParam(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/**
 * Prev / next / Today / pick-a-day controls for the dashboard day overview.
 * Writes the `date` search param (yyyy-MM-dd) and clears `page`.
 */
export function DashboardDayNav({ selectedDate }: { selectedDate: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pickerOpen, setPickerOpen] = useState(false);

  const day = useMemo(() => parseDay(selectedDate), [selectedDate]);
  const today = useMemo(() => new Date(), []);
  const isToday = isSameDay(day, today);

  const goTo = (next: Date) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', toDateParam(next));
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0"
        aria-label="Previous day"
        onClick={() => goTo(subDays(day, 1))}
      >
        <ChevronLeft className="size-4" />
      </Button>

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn('min-w-[12.5rem] justify-start gap-2 font-medium')}
          >
            <CalendarIcon className="size-4 text-muted-foreground" />
            {format(day, 'EEE d MMM yyyy')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={day}
            defaultMonth={day}
            onSelect={(d) => {
              if (!d) return;
              goTo(d);
              setPickerOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0"
        aria-label="Next day"
        onClick={() => goTo(addDays(day, 1))}
      >
        <ChevronRight className="size-4" />
      </Button>

      <Button
        type="button"
        variant={isToday ? 'secondary' : 'ghost'}
        size="sm"
        className="h-9"
        disabled={isToday}
        onClick={() => goTo(today)}
      >
        Today
      </Button>
    </div>
  );
}
