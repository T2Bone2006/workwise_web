import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { Upload, Users, Wrench } from 'lucide-react';
import type { BooksSummary } from '@/lib/books/summary-pure';
import type { TrendMonth } from '@/lib/books/trend';
import type { RoundsHomeData } from '@/lib/data/rounds/home';
import type { NeedsYou } from '@/lib/data/rounds/needs-you';
import type { LatestPayment, RoundValue } from '@/lib/data/rounds/overview';
import type { ComingUp } from '@/lib/rounds/coming-up';
import { listTodayStops, summariseToday } from '@/lib/rounds/today-strip';
import type { WeekGlance } from '@/lib/rounds/week-glance';
import type { WeatherByDay } from '@/lib/weather/met-norway';
import { EmptyState } from '@/components/look';
import { Button } from '@/components/ui/button';
import { WeatherNow } from '@/components/weather/day-weather';
import { WeatherCredit } from '@/components/weather/weather-credit';
import { KpiTiles } from '@/components/rounds/overview/kpi-tiles';
import { MoneyCard } from '@/components/rounds/overview/money-card';
import { NeedsYouCard } from '@/components/rounds/overview/needs-you-card';
import { RoomCard } from '@/components/rounds/overview/room-card';
import { TodayCard } from '@/components/rounds/overview/today-card';
import { WeekStrip } from '@/components/rounds/overview/week-strip';

function greeting(firstName: string | null): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(new Date()),
  );
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return firstName ? `${hello}, ${firstName}` : hello;
}

/**
 * The Rounds overview. It answers, in order: how's today going, what needs me,
 * how's the week and the money, and have I got room for more work. The full stop
 * list and the day's actions live in the Day plan.
 */
export function RoundsHome({
  tenantName,
  firstName,
  data,
  needs,
  books,
  trend,
  lastMonthToDate,
  latestPayments,
  week,
  comingUp,
  workingDays,
  roundValue,
  weather,
}: {
  tenantName: string;
  /** First name of the person signed in, when we have one. */
  firstName: string | null;
  data: RoundsHomeData;
  needs: NeedsYou;
  /** This month's In & out; null when it couldn't be worked out. */
  books: BooksSummary | null;
  trend: TrendMonth[] | null;
  lastMonthToDate: number | null;
  latestPayments: LatestPayment[] | null;
  week: WeekGlance | null;
  /** The 4-week forward view; null when it couldn't be worked out. */
  comingUp: ComingUp | null;
  workingDays: number[];
  roundValue: RoundValue | null;
  /** Forecast for the next 9 days; null when there isn't one. */
  weather: WeatherByDay | null;
}) {
  const round = summariseToday(data.todayVisits);
  const todayWeather = weather?.[data.today] ?? null;
  const owed = {
    total: data.owedTotal,
    customers: data.owedCustomers,
    top: data.owedTop,
    oldestDate: data.owedOldestDate,
  };
  const stops = listTodayStops(data.todayVisits);
  const nextWorkingDay = week?.days.find((d) => d.date > data.today && d.stops > 0) ?? null;

  return (
    <div className="space-y-4 sm:space-y-5">
      <header className="flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-(--tone-rounds-soft) via-card to-(--tone-lite-soft) px-5 py-5 ring-1 ring-border sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:py-5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-wide text-(--tone-rounds-text) uppercase">{tenantName}</p>
          <h1 className="mt-1 text-2xl leading-none font-semibold tracking-tight sm:text-[28px]">{greeting(firstName)}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{format(parseISO(data.today), 'EEEE d MMMM yyyy')}</p>
        </div>
        {todayWeather ? (
          <div className="flex items-center gap-3 self-start rounded-xl bg-card/70 px-3.5 py-2 ring-1 ring-border sm:self-auto">
            <div className="text-right">
              <p className="text-2xl leading-none font-semibold tabular-nums">{todayWeather.highC}°</p>
              <p className="mt-1 text-xs text-muted-foreground">low {todayWeather.lowC}°</p>
            </div>
            <WeatherNow weather={todayWeather} />
          </div>
        ) : null}
      </header>

      {data.catalogEmpty ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-(--tone-amber-line) bg-(--tone-amber-soft) px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-foreground">Add your services first</p>
            <p className="mt-0.5 text-muted-foreground">Defaults for price and how often. Each customer gets their own copy.</p>
          </div>
          <Button size="sm" asChild>
            <Link href="/services">
              <Wrench className="mr-1.5 size-4" />
              Open services
            </Link>
          </Button>
        </div>
      ) : null}

      <KpiTiles today={round} week={week} trend={trend} monthToDateLast={lastMonthToDate} owed={owed} />

      {data.activeCustomers === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          body="Add your first customer, or bring your round in from a spreadsheet, and today's round, the week and the money fill in here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/customers/new">Add customers</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/import">
                  <Upload className="mr-1.5 size-4" />
                  Import a spreadsheet
                </Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
          <div className="min-w-0 lg:col-span-3">
            <TodayCard date={data.today} round={round} stops={stops} weather={todayWeather} nextWorkingDay={nextWorkingDay} />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <NeedsYouCard needs={needs} owed={owed} />
          </div>
        </div>

        <WeekStrip week={week} weather={weather} />

        <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
          <div className="min-w-0 lg:col-span-3">
            <MoneyCard today={data.today} books={books} trend={trend} latest={latestPayments} />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <RoomCard comingUp={comingUp} workingDays={workingDays} roundValue={roundValue} />
          </div>
        </div>
        </>
      )}

      {weather ? <WeatherCredit /> : null}
    </div>
  );
}
