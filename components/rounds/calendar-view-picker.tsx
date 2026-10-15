import Link from 'next/link';
import { cn } from '@/lib/utils';

export type CalendarView = 'day' | 'week' | 'month';

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** The Day / Week / Month switch on every Calendar view. Choosing one keeps the date you were looking at. */
export function CalendarViewPicker(props: { view: CalendarView; date: string }) {
  return (
    <nav aria-label="Calendar view" className="inline-flex rounded-full bg-look-segment p-1 text-sm font-medium">
      {VIEWS.map((view) => {
        const current = view.value === props.view;
        return (
          <Link
            key={view.value}
            href={`/calendar?view=${view.value}&date=${props.date}`}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              current ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
