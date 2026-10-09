import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { monthGridDays } from '@/lib/worker/calendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The month as a grid: a number for the day, a count of the jobs on it, a red dot when one is urgent.
 * Today is ringed, the day you picked is filled. Choosing a day shows its jobs underneath.
 */
export function WorkerMonthGrid({
  date,
  selected,
  today,
  counts,
  urgent,
}: {
  /** Any day in the month being shown. */
  date: string;
  selected: string;
  today: string;
  counts: Record<string, number>;
  urgent: ReadonlySet<string>;
}) {
  const days = monthGridDays(date);
  const month = date.slice(0, 7);
  const monthTotal = days.filter((d) => d.startsWith(month)).reduce((sum, d) => sum + (counts[d] ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{format(parseISO(`${month}-01`), 'MMMM yyyy')}</h2>
        <p className="text-sm text-muted-foreground">
          {monthTotal === 0 ? 'No jobs this month' : `${monthTotal} ${monthTotal === 1 ? 'job' : 'jobs'} this month`}
        </p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--look-card-shadow)">
        <div className="grid grid-cols-7 border-b border-border bg-muted/50">
          {WEEKDAYS.map((label) => (
            <div key={label} className="px-1 py-2 text-center text-[10px] font-medium text-muted-foreground sm:px-2 sm:text-xs">
              <span className="sm:hidden">{label.slice(0, 1)}</span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((ymd, index) => {
            const inMonth = ymd.startsWith(month);
            const count = counts[ymd] ?? 0;
            const isToday = ymd === today;
            const isSelected = ymd === selected;
            const label = `${format(parseISO(ymd), 'd MMMM')}, ${count === 0 ? 'no jobs' : count === 1 ? '1 job' : `${count} jobs`}`;
            return (
              <Link
                key={ymd}
                href={`/worker/calendar?view=month&date=${ymd}`}
                aria-label={label}
                aria-current={isSelected ? 'date' : undefined}
                className={cn(
                  'relative flex min-h-[3.5rem] flex-col items-start gap-1 border-border p-1.5 transition-colors sm:min-h-[5.25rem] sm:p-2',
                  'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  index % 7 !== 6 && 'border-r',
                  index < days.length - 7 && 'border-b',
                  !inMonth && 'bg-muted/30 text-muted-foreground',
                  isSelected ? 'bg-(--tone-rounds-soft)' : 'hover:bg-muted/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums sm:text-sm',
                    isToday && 'bg-(--tone-rounds-solid) text-white',
                    !isToday && isSelected && 'text-(--tone-rounds-text)',
                  )}
                >
                  {Number(ymd.slice(8))}
                </span>
                {count > 0 ? (
                  <span className="flex items-center gap-1">
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums sm:text-xs',
                        inMonth ? 'bg-(--tone-rounds-soft) text-(--tone-rounds-text)' : 'bg-muted text-muted-foreground',
                        isSelected && 'bg-card',
                      )}
                    >
                      {count}
                      <span className="hidden sm:inline"> {count === 1 ? 'job' : 'jobs'}</span>
                    </span>
                    {urgent.has(ymd) ? <span className="size-1.5 rounded-full bg-(--tone-rose-solid)" aria-hidden /> : null}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-(--tone-rounds-solid)" aria-hidden />
          Today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-(--tone-rose-solid)" aria-hidden />A job that is urgent
        </span>
      </p>
    </div>
  );
}
