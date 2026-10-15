import { TriangleAlert } from 'lucide-react';
import { Notice } from '@/components/look';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { LiteOfferSlot } from '@/components/worker/lite-offer-slot';
import { WorkerCalendarNav } from '@/components/worker/worker-calendar-nav';
import { WorkerDayList } from '@/components/worker/worker-day-list';
import { WorkerMonthGrid } from '@/components/worker/worker-month-grid';
import { WorkerWeekBoard } from '@/components/worker/worker-week-board';
import { getMyJobsInRangeResult } from '@/lib/data/worker/jobs';
import { todayInLondon } from '@/lib/rounds/dates';
import { calendarRange, parseCalendarParams } from '@/lib/worker/calendar';
import { weekBoardRange } from '@/lib/worker/week-board';
import { dayCounts, urgentDays } from '@/lib/worker/day-plan';

interface PageProps {
  searchParams: Promise<{ view?: string; date?: string }>;
}

export default async function WorkerCalendarPage({ searchParams }: PageProps) {
  const today = todayInLondon();
  const { view, date } = parseCalendarParams(await searchParams, today);
  const board = view === 'week' ? weekBoardRange(date) : null;
  const range = board ?? calendarRange(view, date);
  const { jobs, ok } = await getMyJobsInRangeResult(range.from, range.to);

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageGradientHeader
        title="Calendar"
        subtitle="Your jobs by day. Accepting and finishing them happens in the WorkWise app."
        actions={<WorkerCalendarNav view={view} date={date} today={today} />}
      />

      {!ok ? (
        <Notice tone="amber" icon={TriangleAlert} title="Couldn't load your jobs">
          Refresh the page to try again. What you see below may be incomplete.
        </Notice>
      ) : null}

      {view === 'week' && board ? (
        <WorkerWeekBoard initialJobs={jobs} initialRange={{ from: board.from, weeks: board.weeks }} today={today} focusDate={date} />
      ) : view === 'month' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <WorkerMonthGrid
            date={date}
            selected={date}
            today={today}
            counts={dayCounts(jobs)}
            urgent={urgentDays(jobs)}
          />
          <WorkerDayList jobs={jobs} date={date} today={today} />
        </div>
      ) : (
        <WorkerDayList jobs={jobs} date={date} today={today} />
      )}

      <LiteOfferSlot />
    </div>
  );
}
