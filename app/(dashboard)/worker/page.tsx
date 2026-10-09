import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { CalendarClock, CircleCheck, TriangleAlert } from 'lucide-react';
import { Notice, StatTile } from '@/components/look';
import { DayCard } from '@/components/worker/day-card';
import { LiteOfferSlot } from '@/components/worker/lite-offer-slot';
import { PhoneNote } from '@/components/worker/phone-note';
import { WeekGlance } from '@/components/worker/week-glance';
import { getWorkerLink } from '@/lib/auth/worker-link';
import { getMyJobsInRangeResult, getMyWaitingJobs } from '@/lib/data/worker/jobs';
import { getMyFirstName } from '@/lib/data/worker/profile';
import { todayInLondon } from '@/lib/rounds/dates';
import { buildDashboard, dashboardWindow, greetingFor, londonHour } from '@/lib/worker/dashboard';

export default async function WorkerDashboardPage() {
  const link = await getWorkerLink();
  const today = todayInLondon();
  const window = dashboardWindow(today);

  const [range, waiting, firstName] = await Promise.all([
    getMyJobsInRangeResult(window.from, window.to),
    getMyWaitingJobs(),
    getMyFirstName(),
  ]);
  const data = buildDashboard(range.jobs, today);
  const n = data.numbers;

  return (
    <div className="space-y-4 sm:space-y-5">
      <header className="rounded-2xl bg-gradient-to-br from-(--tone-rounds-soft) via-card to-(--tone-sky-soft) px-5 py-5 ring-1 ring-border sm:px-6">
        <p className="truncate text-xs font-semibold tracking-wide text-(--tone-rounds-text) uppercase">
          {link?.employerName ?? 'WorkWise'}
        </p>
        <h1 className="mt-1 text-2xl leading-none font-semibold tracking-tight sm:text-[28px]">
          {greetingFor(londonHour(), firstName)}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{format(parseISO(today), 'EEEE d MMMM yyyy')}</p>
      </header>

      {!range.ok ? (
        <Notice tone="amber" icon={TriangleAlert} title="Couldn't load your jobs">
          Refresh the page to try again. What you see below may be incomplete.
        </Notice>
      ) : null}

      {waiting.length > 0 ? (
        <Notice
          tone="sky"
          icon={CalendarClock}
          title={waiting.length === 1 ? '1 new job is waiting for you' : `${waiting.length} new jobs are waiting for you`}
          action={
            <Link
              href="/worker/jobs"
              className="text-sm font-medium text-(--tone-sky-text) underline-offset-4 hover:underline"
            >
              See them
            </Link>
          }
        >
          Open the WorkWise app to accept or decline {waiting.length === 1 ? 'it' : 'them'}.
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start sm:gap-5">
        <div className="space-y-4 sm:space-y-5">
          <DayCard plan={data.today} today={today} nextJobDate={n.nextJobDate} />
          <PhoneNote>Accept, start and finish jobs in the WorkWise app. This page shows where you are up to.</PhoneNote>
        </div>
        <div className="space-y-4 sm:space-y-5">
          <WeekGlance week={data.week} />
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Done"
              value={String(n.doneThisMonth)}
              tone="emerald"
              icon={CircleCheck}
              sub={n.doneThisMonth === 1 ? 'job this month' : 'jobs this month'}
              href="/worker/jobs?tab=done"
            />
            <StatTile
              label="Coming up"
              value={String(n.comingUp)}
              tone="sky"
              icon={CalendarClock}
              sub={n.comingUp === 0 ? 'nothing booked' : 'after today'}
              href="/worker/jobs"
            />
          </div>
          {n.notCompletedRecently > 0 ? (
            <StatTile
              label="Not completed"
              value={String(n.notCompletedRecently)}
              tone="amber"
              icon={TriangleAlert}
              sub="in the last 14 days"
              href="/worker/jobs?tab=not_completed"
            />
          ) : null}
          <LiteOfferSlot />
        </div>
      </div>
    </div>
  );
}
