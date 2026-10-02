import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getMessagingSettings } from '@/lib/data/messaging/settings';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import {
  getVisitCountsForMonth,
  getVisitsForDay,
  getVisitsForRange,
} from '@/lib/data/rounds/visits';
import { getLatestUndoableChange } from '@/lib/actions/rounds/visits';
import { listUntoldMoves } from '@/lib/rounds/visit-changes';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { listOneOffCustomerOptions } from '@/lib/rounds/one-off';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { loadWeather } from '@/lib/data/weather';
import { DayWeather } from '@/components/weather/day-weather';
import { WeatherCredit } from '@/components/weather/weather-credit';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { RoundsMonthGrid } from '@/components/rounds/rounds-month-grid';
import { RoundsDayPlan } from '@/components/rounds/rounds-day-plan';
import { CalendarViewPicker } from '@/components/rounds/calendar-view-picker';
import { WeekBoard } from '@/components/rounds/week-board/week-board';
import { initialRange, rangeEnd } from '@/lib/rounds/week-board';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface CalendarPageProps {
  searchParams: Promise<{
    view?: string;
    date?: string;
  }>;
}

function NoTenantMessage() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">No tenant assigned</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account is not linked to a tenant. Please contact your administrator.
      </p>
    </div>
  );
}

function resolveDate(raw: string | undefined, today: Ymd): Ymd {
  if (raw && isValidYmd(raw)) return raw;
  return today;
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!products.hasRounds) {
    redirect('/dashboard');
  }
  if (!tenantId) {
    return <NoTenantMessage />;
  }

  const raw = await searchParams;
  const today = todayInLondon();
  const date = resolveDate(raw.date, today);
  // No view = the Week board.
  const view = raw.view === 'day' ? 'day' : raw.view === 'month' ? 'month' : 'week';

  const supabase = await createClient();
  const settings = await getRoundsSettings(supabase, tenantId);

  if (view === 'week') {
    const range = initialRange(date);
    const [{ visits, error }, messaging, untold] = await Promise.all([
      getVisitsForRange(tenantId, range.from, rangeEnd(range)),
      getMessagingSettings(supabase, tenantId),
      listUntoldMoves(supabase, tenantId, { today }),
    ]);
    const brand = {
      businessName: messaging.businessName,
      contactPhone: messaging.contact_phone ?? normalizeUkPhoneE164(messaging.companyPhone),
    };

    const weather = await loadWeather(supabase, { tenantId, visitPoints: visits });

    return (
      <div className="space-y-6">
        <PageGradientHeader
          title="Calendar"
          subtitle="Drag jobs and days around, or click one to open it."
          actions={<CalendarViewPicker view="week" date={date} />}
        />
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        <WeekBoard
          weather={weather}
          initialVisits={visits}
          initialRange={range}
          today={today}
          workingDays={settings.working_days}
          blackouts={settings.blackouts}
          brand={brand}
          initialUntold={untold ?? []}
        />
        {weather ? <WeatherCredit /> : null}
      </div>
    );
  }

  if (view === 'day') {
    const [{ visits, error }, { options: customers }, messaging, undoable] = await Promise.all([
      getVisitsForDay(tenantId, date),
      listOneOffCustomerOptions(supabase, tenantId),
      getMessagingSettings(supabase, tenantId),
      getLatestUndoableChange(date),
    ]);
    const brand = {
      businessName: messaging.businessName,
      contactPhone: messaging.contact_phone ?? normalizeUkPhoneE164(messaging.companyPhone),
    };
    const weather = await loadWeather(supabase, { tenantId, visitPoints: visits });
    const dayWeather = weather?.[date];

    return (
      <div className="space-y-6">
        <PageGradientHeader
          title="Day plan"
          subtitle={
            dayWeather ? (
              <span className="flex flex-col gap-1">
                <span>Reorder, optimise, done / skip / reschedule, or move remaining.</span>
                <DayWeather weather={dayWeather} showLabel className="text-sm" />
              </span>
            ) : (
              'Reorder, optimise, done / skip / reschedule, or move remaining.'
            )
          }
          actions={<CalendarViewPicker view="day" date={date} />}
        />
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : null}
        <RoundsDayPlan
          key={visits.map((v) => `${v.id}:${v.status}:${v.route_position ?? ''}`).join('|')}
          date={date}
          visits={visits}
          customers={customers}
          today={today}
          brand={brand}
          undoable={undoable}
        />
        {dayWeather ? <WeatherCredit /> : null}
      </div>
    );
  }

  const { counts, error } = await getVisitCountsForMonth(tenantId, date);

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Calendar"
        subtitle="Month workload and £ — tap a day for the plan."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" asChild>
              <Link href={`/calendar?view=day&date=${today}`}>Open today</Link>
            </Button>
            <CalendarViewPicker view="month" date={date} />
          </div>
        }
      />
      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : null}
      <RoundsMonthGrid
        monthYmd={date}
        counts={counts}
        settings={settings}
        today={today}
      />
    </div>
  );
}
