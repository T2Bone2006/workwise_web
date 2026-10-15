import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { stepDate, type WorkerCalendarView } from '@/lib/worker/calendar';

const VIEWS: { value: WorkerCalendarView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const href = (view: WorkerCalendarView, date: string) => `/worker/calendar?view=${view}&date=${date}`;

/** Day / Week / Month pills, sitting on the right of the page header the way the Rounds calendar does. Day and Month also have previous / today / next. */
export function WorkerCalendarNav({ view, date, today }: { view: WorkerCalendarView; date: string; today: string }) {
  const unit = view === 'day' ? 'day' : 'month';
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {view === 'week' ? null : (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link href={href(view, stepDate(view, date, -1))} aria-label={`Previous ${unit}`}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={href(view, today)}>Today</Link>
          </Button>
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link href={href(view, stepDate(view, date, 1))} aria-label={`Next ${unit}`}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      )}
      <nav aria-label="Calendar view" className="inline-flex rounded-full bg-look-segment p-1 text-sm font-medium">
        {VIEWS.map((v) => (
          <Link
            key={v.value}
            href={href(v.value, date)}
            aria-current={v.value === view ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              v.value === view ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
