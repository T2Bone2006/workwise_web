import Link from 'next/link';
import { CalendarRange, Check } from 'lucide-react';
import { formatGbp } from '@/lib/money/pence';
import type { GlanceDay, WeekGlance } from '@/lib/rounds/week-glance';
import type { WeatherByDay } from '@/lib/weather/met-norway';
import { DayWeather } from '@/components/weather/day-weather';
import { cn } from '@/lib/utils';
import { plural, SectionCard } from './shared';

const weekdayShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const at = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

function statusOf(day: GlanceDay): string {
  return day.isDayOff
    ? day.stops > 0
      ? plural(day.stops, 'stop', 'stops')
      : 'Day off'
    : day.isFree
      ? 'Free'
      : day.isPast
        ? day.stops === 0
          ? 'No stops'
          : `${day.done}/${day.stops} done`
        : plural(day.stops, 'stop', 'stops');
}

function DayTile({ day, busiest, weather }: { day: GlanceDay; busiest: number; weather: WeatherByDay | null }) {
  const fill = busiest > 0 ? Math.round((day.amount / busiest) * 100) : 0;
  const w = weather?.[day.date];
  const status = statusOf(day);

  return (
    <Link
      href={`/calendar?view=day&date=${day.date}`}
      aria-label={`${weekdayShort.format(at(day.date))} ${Number(day.date.slice(8))}: ${status}${day.stops > 0 ? `, ${formatGbp(day.amount)}` : ''}`}
      className={cn(
        'group relative flex min-h-[8.5rem] flex-col rounded-xl border p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:p-3.5',
        day.isToday && 'border-(--tone-rounds-solid) bg-(--tone-rounds-soft) ring-[1.5px] ring-(--tone-rounds-solid)',
        !day.isToday && day.isFree && 'border-(--tone-emerald-line) bg-(--tone-emerald-soft)',
        !day.isToday && !day.isFree && day.isDayOff && 'border-dashed border-border bg-muted/30',
        !day.isToday && !day.isFree && !day.isDayOff && 'border-border bg-background',
        day.isPast && !day.isToday && 'opacity-70',
      )}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span
          className={cn(
            'text-xs font-semibold',
            day.isToday ? 'text-(--tone-rounds-solid)' : 'text-foreground',
          )}
        >
          {day.isToday ? 'Today' : weekdayShort.format(at(day.date))}
        </span>
        <span className="text-lg font-semibold leading-none tabular-nums">{Number(day.date.slice(8))}</span>
      </div>

      <div className="mt-1.5 min-h-4">{w ? <DayWeather weather={w} /> : null}</div>

      <div className="mt-auto pt-2">
        <p
          className={cn(
            'flex items-center gap-1 text-xs font-medium',
            day.isFree && 'text-(--tone-emerald-text)',
            day.isDayOff && day.stops === 0 && 'text-muted-foreground',
          )}
        >
          {day.isPast && day.stops > 0 && day.done === day.stops ? (
            <Check className="size-3.5 text-(--tone-emerald-text)" aria-hidden="true" />
          ) : null}
          {status}
        </p>
        {day.stops > 0 ? (
          <p className="text-sm font-semibold tabular-nums">{formatGbp(day.amount)}</p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn('h-full rounded-full', day.isPast ? 'bg-(--tone-rounds-solid)/50' : 'bg-(--tone-rounds-solid)')}
            style={{ width: `${fill}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

/** The phone version of a day: one row, so the whole week fits without sideways scrolling. */
function DayRow({ day, busiest, weather }: { day: GlanceDay; busiest: number; weather: WeatherByDay | null }) {
  const fill = busiest > 0 ? Math.round((day.amount / busiest) * 100) : 0;
  const w = weather?.[day.date];
  const status = statusOf(day);
  return (
    <Link
      href={`/calendar?view=day&date=${day.date}`}
      className={cn(
        'grid grid-cols-[3.25rem_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5',
        day.isToday && 'border-(--tone-rounds-solid) bg-(--tone-rounds-soft)',
        !day.isToday && day.isFree && 'border-(--tone-emerald-line) bg-(--tone-emerald-soft)',
        !day.isToday && !day.isFree && day.isDayOff && 'border-dashed border-border bg-muted/30',
        !day.isToday && !day.isFree && !day.isDayOff && 'border-border',
        day.isPast && !day.isToday && 'opacity-70',
      )}
    >
      <span className="leading-tight">
        <span className={cn('block text-xs font-semibold', day.isToday ? 'text-(--tone-rounds-solid)' : 'text-foreground')}>
          {day.isToday ? 'Today' : weekdayShort.format(at(day.date))}
        </span>
        <span className="text-base font-semibold tabular-nums">{Number(day.date.slice(8))}</span>
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className={cn('font-medium', day.isFree && 'text-(--tone-emerald-text)', day.isDayOff && day.stops === 0 && 'text-muted-foreground')}>
            {status}
          </span>
          {w ? <DayWeather weather={w} /> : null}
        </span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className={cn('block h-full rounded-full', day.isPast ? 'bg-(--tone-rounds-solid)/50' : 'bg-(--tone-rounds-solid)')} style={{ width: `${fill}%` }} />
        </span>
      </span>
      <span className="text-right text-sm font-semibold tabular-nums">{day.stops > 0 ? formatGbp(day.amount) : '—'}</span>
    </Link>
  );
}

/**
 * Monday to Sunday at a glance: weather, stops, £ and which days are still free.
 * The bar under each day is that day's £ against the busiest day this week.
 */
export function WeekStrip({ week, weather }: { week: WeekGlance | null; weather: WeatherByDay | null }) {
  const busiest = week ? Math.max(0, ...week.days.map((d) => d.amount)) : 0;
  return (
    <SectionCard
      icon={CalendarRange}
      tone="indigo"
      title="This week"
      summary={
        week
          ? `${plural(week.stops, 'stop', 'stops')} · ${formatGbp(week.amount)} booked · ${formatGbp(week.doneAmount)} done so far`
          : undefined
      }
      action={{ href: '/calendar?view=week', label: 'Calendar' }}
      labelledBy="week-heading"
    >
      {week == null ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this week.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto p-1.5 sm:block lg:overflow-visible lg:p-1">
            <div className="grid min-w-[44rem] grid-cols-7 gap-3 lg:min-w-0">
              {week.days.map((day) => (
                <DayTile key={day.date} day={day} busiest={busiest} weather={weather} />
              ))}
            </div>
          </div>
          <div className="space-y-2 sm:hidden">
            {week.days.map((day) => (
              <DayRow key={day.date} day={day} busiest={busiest} weather={weather} />
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-5 rounded-full bg-(--tone-rounds-solid)" aria-hidden="true" />
              Bar = that day&apos;s £ against your busiest day
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm border border-(--tone-emerald-solid)/50 bg-(--tone-emerald-soft)" aria-hidden="true" />
              Free = a working day with nothing booked
            </span>
          </p>
        </>
      )}
    </SectionCard>
  );
}
