import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { CalendarRange } from 'lucide-react';
import { LookCard } from '@/components/look';
import { cn } from '@/lib/utils';
import type { WeekDay } from '@/lib/worker/dashboard';

function statusOf(day: WeekDay): string {
  const { total, done, notCompleted } = day.plan;
  if (total === 0) return day.isPast ? 'No jobs' : 'Free';
  if (day.isPast) return done + notCompleted === total ? `${total} ${total === 1 ? 'job' : 'jobs'}, all done` : `${done + notCompleted}/${total} done`;
  return `${total} ${total === 1 ? 'job' : 'jobs'}`;
}

/** Monday to Sunday: how many jobs each day, today ringed. Each day opens in the calendar. */
export function WeekGlance({ week }: { week: WeekDay[] }) {
  const busiest = Math.max(1, ...week.map((d) => d.plan.total));
  const total = week.reduce((sum, d) => sum + d.plan.total, 0);
  return (
    <LookCard
      title="This week"
      icon={CalendarRange}
      tone="indigo"
      aside={total === 0 ? 'Nothing booked' : `${total} ${total === 1 ? 'job' : 'jobs'}`}
    >
      <ul className="space-y-1.5">
        {week.map((day) => {
          const free = day.plan.total === 0;
          return (
            <li key={day.date}>
              <Link
                href={`/worker/calendar?view=day&date=${day.date}`}
                aria-label={`${format(parseISO(day.date), 'EEEE d MMMM')}: ${statusOf(day)}`}
                className={cn(
                  'grid grid-cols-[3rem_1fr] items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  day.isToday
                    ? 'border-(--tone-rounds-solid) bg-(--tone-rounds-soft)'
                    : free && !day.isPast
                      ? 'border-(--tone-emerald-line) bg-(--tone-emerald-soft)'
                      : 'border-border hover:border-(--tone-rounds-solid)/40',
                  day.isPast && !day.isToday && 'opacity-70',
                )}
              >
                <span className="leading-tight">
                  <span className={cn('block text-xs font-semibold', day.isToday ? 'text-(--tone-rounds-text)' : 'text-foreground')}>
                    {day.isToday ? 'Today' : format(parseISO(day.date), 'EEE')}
                  </span>
                  <span className="text-base font-semibold tabular-nums">{Number(day.date.slice(8))}</span>
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-medium', free && !day.isPast && 'text-(--tone-emerald-text)', free && day.isPast && 'text-muted-foreground')}>
                    {statusOf(day)}
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span
                      className={cn('block h-full rounded-full', day.isPast ? 'bg-(--tone-rounds-solid)/50' : 'bg-(--tone-rounds-solid)')}
                      style={{ width: `${Math.round((day.plan.total / busiest) * 100)}%` }}
                    />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </LookCard>
  );
}
