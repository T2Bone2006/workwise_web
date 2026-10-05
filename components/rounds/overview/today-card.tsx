import Link from 'next/link';
import { Check, CheckCircle2, PartyPopper, Route, SkipForward } from 'lucide-react';
import { Tag } from '@/components/look';
import { formatGbp } from '@/lib/money/pence';
import type { StopRow, TodayRound } from '@/lib/rounds/today-strip';
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
    <div
      className="flex h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={round.done}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label="Stops done today"
    >
      <span className="h-full bg-(--tone-rounds-solid)" style={{ width: pct(round.done) }} />
      <span className="h-full bg-(--tone-rose-solid)" style={{ width: pct(round.skipped) }} />
    </div>
  );
}

const ROW_LIMIT = 7;

const STATE_TAG: Record<'done' | 'skipped' | 'next' | 'todo', { tone: 'rose' | 'rounds'; label: string } | null> = {
  done: null,
  skipped: { tone: 'rose', label: 'Skipped' },
  next: { tone: 'rounds', label: 'Next' },
  todo: null,
};

function StateDot({ state }: { state: StopRow['state'] }) {
  if (state === 'done') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--tone-emerald-solid) text-white">
        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        <span className="sr-only">Done</span>
      </span>
    );
  }
  if (state === 'skipped') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--tone-rose-soft) text-(--tone-rose-text)">
        <SkipForward className="size-3" aria-hidden="true" />
        <span className="sr-only">Skipped</span>
      </span>
    );
  }
  if (state === 'next') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-(--tone-rounds-solid) text-(--tone-rounds-text)">
        <span className="size-2 rounded-full bg-(--tone-rounds-solid)" />
        <span className="sr-only">Next</span>
      </span>
    );
  }
  return <span className="size-5 shrink-0 rounded-full border-2 border-border" aria-hidden="true" />;
}

/** The stops in order: done ticked off, the next one picked out, the rest waiting. Long rounds show a window around "next". */
function StopList({ stops, href }: { stops: StopRow[]; href: string }) {
  const focus = Math.max(0, stops.findIndex((s) => s.state === 'next'));
  const lastFocus = stops.some((s) => s.state === 'next') ? focus : stops.length - 1;
  const start = Math.max(0, Math.min(lastFocus - 2, stops.length - ROW_LIMIT));
  const shown = stops.slice(start, start + ROW_LIMIT);
  const before = start;
  const after = stops.length - (start + shown.length);

  return (
    <div>
      {before > 0 ? <p className="mb-1.5 px-1 text-xs text-muted-foreground">{plural(before, 'earlier stop', 'earlier stops')}</p> : null}
      <ol className="flex flex-col gap-1.5">
        {shown.map((stop, i) => {
          const tag = STATE_TAG[stop.state];
          return (
            <li key={`${stop.street}-${start + i}`}>
              <Link
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3.5 py-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  stop.state === 'next' ? 'bg-(--tone-rounds-soft) ring-1 ring-(--tone-rounds-solid)/40' : 'bg-background hover:bg-muted',
                )}
              >
                <StateDot state={stop.state} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-medium',
                      (stop.state === 'done' || stop.state === 'skipped') && 'text-muted-foreground line-through decoration-1',
                    )}
                  >
                    {stop.customerName ?? stop.street}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {stop.street}
                    {stop.work ? ` · ${stop.work}` : ''}
                  </span>
                </span>
                {tag ? <Tag tone={tag.tone}>{stop.state === 'next' && stop.time ? `Next · ${stop.time}` : tag.label}</Tag> : stop.time && stop.state === 'todo' ? <span className="text-xs text-muted-foreground tabular-nums">{stop.time}</span> : null}
                <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">{formatGbp(stop.amount)}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      {after > 0 ? <p className="mt-1.5 px-1 text-xs text-muted-foreground">+ {plural(after, 'more stop', 'more stops')} after these</p> : null}
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
  stops,
  weather,
  nextWorkingDay,
}: {
  date: string;
  round: TodayRound;
  /** Every house on the round, in order, with its state. */
  stops: StopRow[];
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
          {round.stops > 0 ? `${round.done} of ${plural(round.stops, 'stop', 'stops')} done · ` : ''}
          {summary}
          {weather ? <DayWeather weather={weather} showLabel /> : null}
        </span>
      }
      aside={
        round.stops > 0 ? (
          <span className="text-[13px] font-semibold text-(--tone-emerald-text) tabular-nums">
            {formatGbp(round.doneAmount)} of {formatGbp(round.plannedAmount)}
          </span>
        ) : null
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
        <div className="space-y-3">
          <Progress round={round} />
          {round.next ? (
            <StopList stops={stops} href={dayPlan} />
          ) : (
            <div
              className={cn(
                'flex items-center gap-3 rounded-xl border px-4 py-3',
                'border-(--tone-emerald-line) bg-(--tone-emerald-soft)',
              )}
            >
              <PartyPopper className="size-5 shrink-0 text-(--tone-emerald-text)" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-semibold">All done for today</p>
                <p className="text-muted-foreground">
                  {plural(round.done, 'stop', 'stops')} done, {formatGbp(round.doneAmount)} earned
                  {round.skipped > 0 ? ` · ${round.skipped} skipped` : ''}.
                </p>
              </div>
              {round.skipped > 0 ? (
                <SkipForward className="ml-auto size-4 text-(--tone-rose-text)" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="ml-auto size-4 text-(--tone-emerald-text)" aria-hidden="true" />
              )}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
