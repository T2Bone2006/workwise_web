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
import { PersonFilter } from '@/components/rounds/person-filter';
import { AssigneeProvider } from '@/components/team/assignee-chip';
import { getCalendarTeam, getOffContext } from '@/lib/data/rounds/calendar-team';
import { DaysOffWarning } from '@/components/team/days-off-warning';
import { SomeoneOffButton } from '@/components/team/someone-off-button';
import { filterByPerson, parsePersonParam } from '@/lib/rounds/lanes';
import { WeekBoard } from '@/components/rounds/week-board/week-board';
import { initialRange, rangeEnd } from '@/lib/rounds/week-board';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface CalendarPageProps {
  searchParams: Promise<{
    view?: string;
    date?: string;
    person?: string;
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
  // Lanes and the Person filter exist only for a business with a lead; without one the calendar is exactly as it was.
  const [settings, team] = await Promise.all([
    getRoundsSettings(supabase, tenantId),
    getCalendarTeam(tenantId, today),
  ]);
  const person = team ? parsePersonParam(raw.person, team.people) : 'all';

  if (view === 'week') {
    const range = initialRange(date);
    const visitsPromise = getVisitsForRange(tenantId, range.from, rangeEnd(range));
    const [{ visits, error }, messaging, untold, off, weather] = await Promise.all([
      visitsPromise,
      getMessagingSettings(supabase, tenantId),
      listUntoldMoves(supabase, tenantId, { today }),
      getOffContext(tenantId, today, range.from, rangeEnd(range)),
      // Starts with the rest; it only waits for the visits when there is no start postcode.
      loadWeather(supabase, {
        tenantId,
        startPostcode: settings.start_postcode,
        visitPoints: visitsPromise.then((r) =>
          team && person !== 'all' ? filterByPerson(r.visits, person, team.people) : r.visits,
        ),
      }),
    ]);
    const brand = {
      businessName: messaging.businessName,
      contactPhone: messaging.contact_phone ?? normalizeUkPhoneE164(messaging.companyPhone),
    };

    const shownVisits = team && person !== 'all' ? filterByPerson(visits, person, team.people) : visits;
    // A dot per visit only when everyone is shown and more than one person has work this week.
    const ownerId = team?.people.find((p) => p.isOwner)?.workerId ?? null;
    const workers = new Set(shownVisits.map((v) => v.assigned_worker_id ?? ownerId));
    const showAssignees = Boolean(team) && person === 'all' && workers.size > 1;

    const board = (
      <WeekBoard
        weather={weather}
        initialVisits={shownVisits}
        initialRange={range}
        today={today}
        workingDays={settings.working_days}
        blackouts={settings.blackouts}
        brand={brand}
        initialUntold={untold ?? []}
        person={person === 'all' ? undefined : person}
        people={team?.people}
        daysOff={off?.daysOff}
      />
    );

    return (
      <div className="space-y-6">
        <PageGradientHeader
          title="Calendar"
          subtitle="Drag jobs and days around, or click one to open it."
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {team ? <PersonFilter view="week" date={date} value={person} people={team.people} /> : null}
              {off ? <SomeoneOffButton people={off.people} existing={off.daysOff} today={today} /> : null}
              <CalendarViewPicker view="week" date={date} />
            </div>
          }
        />
        {off ? <DaysOffWarning warnings={off.warnings} people={off.people} daysOff={off.daysOff} /> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {team ? (
          <AssigneeProvider people={team.people} show={showAssignees}>
            {board}
          </AssigneeProvider>
        ) : (
          board
        )}
        {weather ? <WeatherCredit /> : null}
      </div>
    );
  }

  if (view === 'day') {
    const visitsPromise = getVisitsForDay(tenantId, date);
    const [{ visits, error }, { options: customers }, messaging, undoable, off, weather] = await Promise.all([
      visitsPromise,
      listOneOffCustomerOptions(supabase, tenantId),
      getMessagingSettings(supabase, tenantId),
      getLatestUndoableChange(date),
      getOffContext(tenantId, today, date, date),
      loadWeather(supabase, {
        tenantId,
        startPostcode: settings.start_postcode,
        visitPoints: visitsPromise.then((r) => r.visits),
      }),
    ]);
    const brand = {
      businessName: messaging.businessName,
      contactPhone: messaging.contact_phone ?? normalizeUkPhoneE164(messaging.companyPhone),
    };
    const dayWeather = weather?.[date];

    return (
      <div className="space-y-6">
        <PageGradientHeader
          title="Day plan"
          subtitle={
            dayWeather ? (
              <span className="flex flex-col gap-1">
                <span>The houses for this day, in the order you&apos;ll do them.</span>
                <DayWeather weather={dayWeather} showLabel className="text-sm" />
              </span>
            ) : (
              "The houses for this day, in the order you'll do them."
            )
          }
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {off ? <SomeoneOffButton people={off.people} existing={off.daysOff} today={today} /> : null}
              <CalendarViewPicker view="day" date={date} />
            </div>
          }
        />
        {off ? <DaysOffWarning warnings={off.warnings} people={off.people} daysOff={off.daysOff} /> : null}
        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : null}
        <RoundsDayPlan
          key={visits.map((v) => `${v.id}:${v.status}:${v.route_position ?? ''}:${v.assigned_worker_id ?? ''}`).join('|')}
          date={date}
          visits={visits}
          customers={customers}
          today={today}
          brand={brand}
          undoable={undoable}
          team={team ? { people: team.people, off: [...team.offOn(date)], focus: person } : undefined}
        />
        {dayWeather ? <WeatherCredit /> : null}
      </div>
    );
  }

  const [off, { counts, error }] = await Promise.all([
    getOffContext(tenantId, today, date, date),
    getVisitCountsForMonth(
      tenantId,
      date,
      team && person !== 'all' ? { personId: person, people: team.people } : undefined,
    ),
  ]);

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
            {team ? <PersonFilter view="month" date={date} value={person} people={team.people} /> : null}
            {off ? <SomeoneOffButton people={off.people} existing={off.daysOff} today={today} /> : null}
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
