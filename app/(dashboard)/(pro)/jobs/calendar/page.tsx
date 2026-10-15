import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getWorkersForTenant } from '@/lib/data/workers';
import { getProCalendarJobs } from '@/lib/data/pro-calendar';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { Legend, Tag } from '@/components/look';
import { Button } from '@/components/ui/button';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import {
  countJobs,
  fetchWindow,
  filterJobs,
  parseCalendarView,
  parsePersonFilter,
  rangeLabel,
  shiftAnchor,
  showingToday,
  type ProCalendarView,
} from '@/lib/jobs/pro-calendar';
import { calendarHref, ProCalendarViewPicker } from '@/components/jobs/calendar/calendar-view-picker';
import { ProPersonFilter } from '@/components/jobs/calendar/pro-person-filter';
import { NoDateToggle } from '@/components/jobs/calendar/no-date-toggle';
import { ProWeekBoard } from '@/components/jobs/calendar/pro-week-board';
import { ProDayLanes } from '@/components/jobs/calendar/pro-day-lanes';
import { ProMonthGrid } from '@/components/jobs/calendar/pro-month-grid';

interface CalendarPageProps {
  searchParams: Promise<{ view?: string; date?: string; person?: string }>;
}

const SUBTITLE: Record<ProCalendarView, string> = {
  day: "Who's doing what, and who's free. Drag a job onto someone to give it to them.",
  week: 'Scroll through the weeks. Drag jobs between days, or click one to open it, move it or give it to someone.',
  month: 'How busy each day is, and what still has no one. Click a day to plan it.',
};

const CARD_LEGEND = [
  { label: 'Needs you: no one yet or not sent', tone: 'amber' as const },
  { label: 'With a worker', tone: 'indigo' as const },
  { label: 'In progress', tone: 'sky' as const },
  { label: 'Declined or not finished', tone: 'rose' as const },
  { label: 'Done', tone: 'emerald' as const },
];

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

export default async function ProCalendarPage({ searchParams }: CalendarPageProps) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return <NoTenantMessage />;

  const raw = await searchParams;
  const today = todayInLondon();
  const date: Ymd = raw.date && isValidYmd(raw.date) ? raw.date : today;
  const view = parseCalendarView(raw.view);
  const window = fetchWindow(view, date);

  const [loaded, { workers: rows }] = await Promise.all([
    getProCalendarJobs(tenantId, window.from, window.to),
    getWorkersForTenant(tenantId),
  ]);
  const workers = rows
    .map((worker) => ({ id: worker.id, name: worker.full_name?.trim() || 'Worker' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // The Day view shows everyone in lanes, so the Person filter is for the week and the month.
  const person = view === 'day' ? 'all' : parsePersonFilter(raw.person, workers);

  const inRange = filterJobs(loaded.jobs, person);
  const counts = countJobs(inRange);
  const undatedShown = filterJobs(loaded.undated, person).length;
  const needsSomeone = counts.noOne + counts.declined;

  const previous = calendarHref(view, shiftAnchor(view, date, -1), person);
  const next = calendarHref(view, shiftAnchor(view, date, 1), person);

  const tags = (
    <>
      {needsSomeone > 0 && person !== 'none' && view !== 'day' ? (
        <Link href={calendarHref(view, date, 'none')} className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Tag tone="amber">{needsSomeone} with no one yet</Tag>
        </Link>
      ) : null}
      {counts.notSent > 0 ? (
        <Link href="/jobs?status=pending_send" className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Tag tone="amber">{counts.notSent} given, not sent</Tag>
        </Link>
      ) : null}
      {view === 'month' ? null : <NoDateToggle count={undatedShown} />}
    </>
  );

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Calendar"
        subtitle={SUBTITLE[view]}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {view === 'day' ? null : <ProPersonFilter view={view} date={date} value={person} workers={workers} />}
            <ProCalendarViewPicker view={view} date={date} person={person} />
          </div>
        }
      />

      {view === 'week' ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" className="size-8" asChild>
              <Link href={previous} aria-label={`Previous ${view}`}>
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
            <h2 className="min-w-36 text-center text-lg font-semibold tracking-tight">
              {rangeLabel(view, date)}
              {view === 'day' && date === today ? <span className="ml-2 text-sm font-normal text-muted-foreground">Today</span> : null}
            </h2>
            <Button variant="outline" size="icon" className="size-8" asChild>
              <Link href={next} aria-label={`Next ${view}`}>
                <ChevronRight className="size-4" />
              </Link>
            </Button>
            {showingToday(view, date, today) ? null : (
              <Button variant="outline" size="sm" asChild>
                <Link href={calendarHref(view, today, person)}>Today</Link>
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">{tags}</div>
        </div>
      )}

      {loaded.error ? <p className="text-sm text-destructive">{loaded.error.message}</p> : null}
      {loaded.truncated ? (
        <p className="text-sm text-muted-foreground">Showing the first jobs in this range. Pick a person to see fewer, or open the jobs list.</p>
      ) : null}

      {view === 'month' ? (
        <ProMonthGrid date={date} today={today} jobs={inRange} person={person} />
      ) : view === 'day' ? (
        <ProDayLanes key={date} date={date} today={today} jobs={loaded.jobs} undated={loaded.undated} workers={workers} />
      ) : (
        <ProWeekBoard
          key={date}
          date={date}
          today={today}
          jobs={loaded.jobs}
          undated={loaded.undated}
          workers={workers}
          person={person}
          extra={tags}
        />
      )}

      {view === 'month' ? null : <Legend items={CARD_LEGEND} />}
    </div>
  );
}
