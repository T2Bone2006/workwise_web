import Link from 'next/link';
import { CheckCircle2, Clock, MapPin, Navigation, PartyPopper, Route, SkipForward } from 'lucide-react';
import { formatGbp } from '@/lib/money/pence';
import type { StopPreview, TodayRound } from '@/lib/rounds/today-strip';
import type { GlanceDay } from '@/lib/rounds/week-glance';
import type { DayWeather as DayWeatherData } from '@/lib/weather/met-norway';
import { DayWeather } from '@/components/weather/day-weather';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatShortDate, plural, SectionCard } from './shared';

function Progress({ round }: { round: TodayRound }) {
  const total = round.stops + round.skipped;
  const pct = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {round.done}
          <span className="text-lg font-medium text-muted-foreground"> / {round.stops}</span>
        </p>
        <p className="text-right text-sm text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{formatGbp(round.doneAmount)}</span> of{' '}
          {formatGbp(round.plannedAmount)}
        </p>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="h-full bg-emerald-500" style={{ width: pct(round.done) }} />
        <span className="h-full bg-orange-400" style={{ width: pct(round.skipped) }} />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
          {round.done} done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          {round.toGo} to go
        </span>
        {round.skipped > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-orange-400" aria-hidden="true" />
            {round.skipped} skipped
          </span>
        ) : null}
      </p>
    </div>
  );
}

function NextStop({ stop, href }: { stop: StopPreview; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-sky-500/30 bg-sky-500/[0.07] p-3.5 transition-colors hover:bg-sky-500/[0.12] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
            <Navigation className="size-3" aria-hidden="true" /> Next stop
          </p>
          <p className="mt-1 truncate text-base font-semibold">{stop.customerName ?? stop.street}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {stop.street}
          </p>
          {stop.work ? <p className="mt-1 truncate text-xs text-muted-foreground">{stop.work}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold tabular-nums">{formatGbp(stop.amount)}</p>
          {stop.time ? (
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" aria-hidden="true" />
              {stop.time}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function UpNext({ stops }: { stops: StopPreview[] }) {
  if (stops.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Then</p>
      <ol className="divide-y divide-border/60 rounded-xl border border-border/60">
        {stops.map((stop, i) => (
          <li key={`${stop.street}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
              {i + 2}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{stop.customerName ?? stop.street}</span>
              {stop.customerName ? <span className="text-muted-foreground"> · {stop.street}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatGbp(stop.amount)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Today's round in one card: how far through, what it's worth, where to go next.
 * The full list and the day's actions (move, skip, optimise) are in the Day plan.
 */
export function TodayCard({
  date,
  round,
  weather,
  nextWorkingDay,
}: {
  date: string;
  round: TodayRound;
  weather: DayWeatherData | null;
  /** When nothing is booked today: the next day this week that has stops. */
  nextWorkingDay: GlanceDay | null;
}) {
  const dayPlan = `/calendar?view=day&date=${date}`;
  const summary =
    round.stops === 0
      ? 'Nothing booked'
      : round.toGo === 0
        ? 'Round finished'
        : `${plural(round.toGo, 'stop', 'stops')} to go`;

  return (
    <SectionCard
      icon={Route}
      tone="sky"
      title="Today's round"
      summary={
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {summary}
          {weather ? <DayWeather weather={weather} showLabel /> : null}
        </span>
      }
      action={{ href: dayPlan, label: 'Day plan' }}
      labelledBy="today-heading"
    >
      {round.stops === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-4 py-6 text-center">
          <p className="text-sm font-medium">Nothing booked for today</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {nextWorkingDay
              ? `Next round: ${formatShortDate(nextWorkingDay.date)} · ${plural(nextWorkingDay.stops, 'stop', 'stops')} · ${formatGbp(nextWorkingDay.amount)}`
              : 'Add a one-off job, or pick another day in the calendar.'}
          </p>
          {nextWorkingDay ? (
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link href={`/calendar?view=day&date=${nextWorkingDay.date}`}>Open {formatShortDate(nextWorkingDay.date)}</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <Progress round={round} />
          {round.next ? (
            <>
              <NextStop stop={round.next} href={dayPlan} />
              <UpNext stops={round.upNext} />
            </>
          ) : (
            <div
              className={cn(
                'flex items-center gap-3 rounded-xl border px-4 py-3',
                'border-emerald-500/30 bg-emerald-500/[0.07]',
              )}
            >
              <PartyPopper className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-semibold">All done for today</p>
                <p className="text-muted-foreground">
                  {plural(round.done, 'stop', 'stops')} done, {formatGbp(round.doneAmount)} earned
                  {round.skipped > 0 ? ` · ${round.skipped} skipped` : ''}.
                </p>
              </div>
              {round.skipped > 0 ? (
                <SkipForward className="ml-auto size-4 text-orange-500" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="ml-auto size-4 text-emerald-600" aria-hidden="true" />
              )}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
