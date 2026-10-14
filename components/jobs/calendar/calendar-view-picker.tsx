import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { PersonFilter, ProCalendarView } from '@/lib/jobs/pro-calendar';

const VIEWS: { value: ProCalendarView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export function calendarHref(view: ProCalendarView, date: string, person: PersonFilter = 'all'): string {
  return `/jobs/calendar?view=${view}&date=${date}${person === 'all' ? '' : `&person=${encodeURIComponent(person)}`}`;
}

/** Day, week, and month. The date and the person you are looking at stay put. */
export function ProCalendarViewPicker(props: { view: ProCalendarView; date: string; person?: PersonFilter }) {
  return (
    <nav aria-label="Calendar view" className="inline-flex rounded-full bg-look-segment p-1 text-sm font-medium">
      {VIEWS.map((view) => {
        const current = view.value === props.view;
        return (
          <Link
            key={view.value}
            href={calendarHref(view.value, props.date, props.person)}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'rounded-full px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
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
