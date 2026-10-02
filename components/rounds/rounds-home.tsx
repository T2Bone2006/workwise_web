import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { Users, Wrench } from 'lucide-react';
import type { BooksSummary } from '@/lib/books/summary-pure';
import type { TrendMonth } from '@/lib/books/trend';
import type { RoundsHomeData } from '@/lib/data/rounds/home';
import type { NeedsYou } from '@/lib/data/rounds/needs-you';
import type { LatestPayment, RoundValue } from '@/lib/data/rounds/overview';
import type { ComingUp } from '@/lib/rounds/coming-up';
import { summariseToday } from '@/lib/rounds/today-strip';
import type { WeekGlance } from '@/lib/rounds/week-glance';
import type { WeatherByDay } from '@/lib/weather/met-norway';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { Button } from '@/components/ui/button';
import { WeatherNow } from '@/components/weather/day-weather';
import { WeatherCredit } from '@/components/weather/weather-credit';
import { KpiTiles } from '@/components/rounds/overview/kpi-tiles';
import { MoneyCard } from '@/components/rounds/overview/money-card';
import { NeedsYouCard } from '@/components/rounds/overview/needs-you-card';
import { RoomCard } from '@/components/rounds/overview/room-card';
import { TodayCard } from '@/components/rounds/overview/today-card';
import { WeekStrip } from '@/components/rounds/overview/week-strip';

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The Rounds overview. It answers, in order: how's today going, what needs me,
 * how's the week and the money, and have I got room for more work. The full stop
 * list and the day's actions live in the Day plan.
 */
export function RoundsHome({
  tenantName,
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
  const nextWorkingDay = week?.days.find((d) => d.date > data.today && d.stops > 0) ?? null;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageGradientHeader
        eyebrow={tenantName}
        title={greeting()}
        subtitle={format(parseISO(data.today), 'EEEE d MMMM yyyy')}
        actions={
          todayWeather ? (
            <div className="flex items-center gap-3 rounded-xl border border-white/40 bg-white/40 px-3.5 py-2 dark:border-white/10 dark:bg-white/5">
              <div className="text-right">
                <p className="text-2xl font-semibold leading-none tabular-nums">{todayWeather.highC}°</p>
                <p className="mt-1 text-xs text-muted-foreground">low {todayWeather.lowC}°</p>
              </div>
              <WeatherNow weather={todayWeather} />
            </div>
          ) : null
        }
      />

      {data.catalogEmpty ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Add your services first</p>
          <p className="mt-0.5 text-muted-foreground">
            Defaults for price and how often — each customer gets their own copy.
          </p>
          <Button className="mt-3" size="sm" asChild>
            <Link href="/services">
              <Wrench className="mr-1.5 size-4" />
              Open services
            </Link>
          </Button>
        </div>
      ) : null}

      {data.activeCustomers === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-6 py-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-muted bg-muted/30">
            <Users className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">No customers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add your first customer to start planning the round.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/customers/new">Add customer</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <KpiTiles today={round} week={week} trend={trend} monthToDateLast={lastMonthToDate} owed={owed} />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <TodayCard date={data.today} round={round} weather={todayWeather} nextWorkingDay={nextWorkingDay} />
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

      {weather ? <WeatherCredit /> : null}
    </div>
  );
}
