import Link from 'next/link';
import {
  countJobs,
  dayChips,
  monthCells,
  type PersonFilter,
  type ProCalendarJob,
} from '@/lib/jobs/pro-calendar';
import type { Ymd } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';
import { calendarHref } from './calendar-view-picker';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Soft curve so a moderately busy day still reads, as on the Rounds month. */
function heatStrength(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return 0.12 + Math.min(1, value / max) * 0.43;
}

/**
 * The month, like the Rounds month: each day's jobs and groups, how many still have no one, and how much is done.
 * Darker days are busier. Click a day to plan it.
 */
export function ProMonthGrid(props: { date: Ymd; today: Ymd; jobs: ProCalendarJob[]; person: PersonFilter }) {
  const cells = monthCells(props.date);
  const byDate = new Map<string, ProCalendarJob[]>();
  for (const job of props.jobs) {
    if (!job.date) continue;
    const bucket = byDate.get(job.date) ?? [];
    bucket.push(job);
    byDate.set(job.date, bucket);
  }
  const max = Math.max(0, ...[...byDate.values()].map((list) => list.length));

  return (
    <div className="space-y-4">
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
          {cells.map((cell) => {
            const list = byDate.get(cell.ymd) ?? [];
            const counts = countJobs(list);
            const chips = dayChips(list);
            const isToday = cell.ymd === props.today;
            const needs = counts.noOne + counts.declined;
            const heat = list.length > 0 && cell.inMonth ? heatStrength(list.length, max) : 0;
            const progress = counts.total > 0 ? counts.done / counts.total : 0;
            return (
              <Link
                key={cell.ymd}
                href={calendarHref('day', cell.ymd, props.person)}
                className={cn(
                  'relative min-h-[4.75rem] border-r border-b border-border p-1.5 transition-colors sm:min-h-[6.25rem] sm:p-2',
                  'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                  !cell.inMonth && 'opacity-40',
                  isToday && 'ring-2 ring-(--tone-sky-solid) ring-inset',
                )}
              >
                {heat > 0 ? (
                  <div className="pointer-events-none absolute inset-0 bg-(--tone-indigo-solid)" style={{ opacity: heat * 0.6 }} aria-hidden />
                ) : null}
                <div className="relative flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold sm:size-7 sm:text-sm',
                      isToday ? 'bg-(--tone-sky-solid) text-white' : 'text-foreground',
                    )}
                  >
                    {Number(cell.ymd.slice(8))}
                  </span>
                  {needs > 0 ? (
                    <span
                      className="rounded-full bg-(--tone-amber-soft) px-1.5 text-[9px] font-semibold text-(--tone-amber-text) sm:text-[10px]"
                      title={`${needs} with no one yet`}
                    >
                      {needs} no one
                    </span>
                  ) : null}
                </div>
                {list.length > 0 ? (
                  <div className="relative mt-1.5 space-y-1 sm:mt-2">
                    <p className="text-[10px] leading-tight font-semibold text-foreground sm:text-[11px]">
                      <span className="tabular-nums">{list.length}</span>
                      <span className="font-medium text-muted-foreground"> {list.length === 1 ? 'job' : 'jobs'}</span>
                    </p>
                    {chips.groups.length > 0 ? (
                      <>
                        <ul className="hidden space-y-0.5 sm:block" aria-label="Groups that day">
                          {chips.groups.slice(0, 2).map((group) => (
                            <li
                              key={group.id}
                              className="flex items-center gap-1 rounded-md px-1 py-px text-[10px] leading-tight font-medium text-foreground"
                              style={{ backgroundColor: `color-mix(in srgb, ${group.colour} 14%, transparent)` }}
                              title={`${group.name}: ${group.count} ${group.count === 1 ? 'job' : 'jobs'}`}
                            >
                              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: group.colour }} aria-hidden />
                              <span className="min-w-0 flex-1 truncate">{group.name}</span>
                              <span className="text-muted-foreground tabular-nums">{group.count}</span>
                            </li>
                          ))}
                          {chips.groups.length > 2 ? (
                            <li className="px-1 text-[10px] text-muted-foreground">+{chips.groups.length - 2} more</li>
                          ) : null}
                        </ul>
                        <div className="flex gap-0.5 sm:hidden" aria-hidden>
                          {chips.groups.slice(0, 4).map((group) => (
                            <span key={group.id} className="size-1.5 rounded-full" style={{ backgroundColor: group.colour }} />
                          ))}
                        </div>
                      </>
                    ) : null}
                    <div className="h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" title={`${counts.done} of ${counts.total} done`}>
                      <div
                        className={cn('h-full rounded-full', progress >= 1 ? 'bg-(--tone-emerald-solid)' : 'bg-(--tone-emerald-solid)/70')}
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="flex overflow-hidden rounded-sm" aria-hidden="true">
            {[0.1, 0.25, 0.4, 0.55].map((o) => (
              <span key={o} className="h-3 w-4 bg-(--tone-indigo-solid)" style={{ opacity: o }} />
            ))}
          </span>
          Lighter = quieter, darker = busier
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-(--tone-emerald-solid)" aria-hidden="true" />
          Bar = done so far
        </li>
        <li className="flex items-center gap-1.5">
          <span className="rounded-full bg-(--tone-amber-soft) px-1.5 text-[10px] font-semibold text-(--tone-amber-text)">2 no one</span>
          Jobs no one has yet
        </li>
      </ul>
    </div>
  );
}
