import Link from 'next/link';
import { Sprout, TrendingUp } from 'lucide-react';
import type { RoundValue } from '@/lib/data/rounds/overview';
import { formatGbp } from '@/lib/money/pence';
import { sliceComingUp, type ComingUp } from '@/lib/rounds/coming-up';
import { isoWeekday } from '@/lib/rounds/dates';
import { roomDetail, roomForWork, roomHeadline } from '@/lib/rounds/room-for-work';
import { cn } from '@/lib/utils';
import { plural, SectionCard } from './shared';

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * "Can I take on another customer, and when?" The answer in a sentence, then the
 * next four weeks laid out by working day, each day saying "Free" or how many stops.
 */
export function RoomCard({
  comingUp,
  workingDays,
  roundValue,
}: {
  comingUp: ComingUp | null;
  workingDays: number[];
  roundValue: RoundValue | null;
}) {
  const room = comingUp ? roomForWork(comingUp) : null;
  const view = comingUp ? sliceComingUp(comingUp, 4) : null;
  const columns = [...workingDays].sort((a, b) => a - b);
  const busiest = view ? Math.max(1, ...view.weeks.flatMap((w) => w.days.map((d) => d.stops))) : 1;

  return (
    <SectionCard
      icon={Sprout}
      tone="teal"
      title="Room for more work"
      summary="The next 4 weeks, by working day"
      action={{ href: '/calendar?view=week', label: 'Calendar' }}
      labelledBy="room-heading"
      className="h-full"
    >
      {room == null || view == null ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t work out the weeks ahead.</p>
      ) : room.kind === 'empty' ? (
        <p className="text-sm text-muted-foreground">
          Add customers with a regular schedule and you&apos;ll see your free days here.{' '}
          <Link href="/customers" className="font-medium text-primary hover:underline">
            Go to customers
          </Link>
        </p>
      ) : (
        <>
          <div className={cn('rounded-xl border px-3.5 py-3', room.kind === 'full' ? 'border-(--tone-amber-line) bg-(--tone-amber-soft)' : 'border-(--tone-teal-line) bg-(--tone-teal-soft)')}>
            <p className="text-[15px] font-semibold leading-snug">{roomHeadline(room)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{roomDetail(room)}</p>
          </div>

          <table className="w-full table-fixed border-separate border-spacing-1 text-center text-xs">
            <caption className="sr-only">Stops booked on each working day for the next 4 weeks; Free means nothing booked yet</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[4.5rem] text-left font-medium text-muted-foreground">
                  <span className="sr-only">Week</span>
                </th>
                {columns.map((d) => (
                  <th key={d} scope="col" className="font-medium text-muted-foreground">
                    {WEEKDAY[d - 1]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.weeks.map((week) => (
                <tr key={week.weekStart}>
                  <th scope="row" className="text-left font-medium whitespace-nowrap text-muted-foreground">
                    {week.label.replace('w/c ', '')}
                  </th>
                  {columns.map((weekday) => {
                    const day = week.days.find((x) => isoWeekday(x.date) === weekday);
                    const date = day ? Number(day.date.slice(8)) : null;
                    if (!day || !day.plannable) {
                      return (
                        <td key={weekday} className="h-11 rounded-lg bg-muted/20 text-muted-foreground/50" aria-label="Gone">
                          –
                        </td>
                      );
                    }
                    if (day.stops === 0) {
                      return (
                        <td key={weekday} className="h-11 rounded-lg border border-(--tone-emerald-line) bg-(--tone-emerald-soft) p-0">
                          <Link
                            href={`/calendar?view=day&date=${day.date}`}
                            className="flex h-full flex-col items-center justify-center rounded-lg font-semibold text-(--tone-emerald-text) hover:bg-(--tone-emerald-solid)/10"
                          >
                            <span className="text-[10px] font-normal text-muted-foreground">{date}</span>
                            Free
                          </Link>
                        </td>
                      );
                    }
                    const strength = Math.min(1, day.stops / busiest);
                    return (
                      <td key={weekday} className="h-11 rounded-lg p-0" style={{ backgroundColor: `color-mix(in srgb, var(--tone-teal-solid) ${Math.round(8 + strength * 30)}%, transparent)` }}>
                        <Link
                          href={`/calendar?view=day&date=${day.date}`}
                          className="flex h-full flex-col items-center justify-center rounded-lg hover:bg-muted/40"
                          aria-label={`${WEEKDAY[weekday - 1]} ${date}: ${plural(day.stops, 'stop', 'stops')}`}
                        >
                          <span className="text-[10px] text-muted-foreground">{date}</span>
                          <span className="font-semibold tabular-nums">{day.stops}</span>
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="-mt-2 text-xs text-muted-foreground">
            Numbers are stops booked or due from schedules; the darker the day, the busier.
          </p>
        </>
      )}

      {roundValue && roundValue.schedules > 0 ? (
        <div className="mt-auto flex items-center gap-3 border-t border-border/60 pt-3">
          <TrendingUp className="size-4 shrink-0 text-(--tone-teal-text)" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Your regular work is worth about{' '}
            <span className="font-semibold text-foreground">{formatGbp(roundValue.perMonth)} a month</span> from{' '}
            {plural(roundValue.schedules, 'schedule', 'schedules')}.
          </p>
        </div>
      ) : null}
    </SectionCard>
  );
}
