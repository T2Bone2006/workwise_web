import { format, parseISO } from 'date-fns';
import { TriangleAlert } from 'lucide-react';
import { Notice } from '@/components/look';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { CashHeldCard } from '@/components/worker/cash-held-card';
import { DayCard } from '@/components/worker/day-card';
import { LiteOfferSlot } from '@/components/worker/lite-offer-slot';
import { OffersSection } from '@/components/worker/offer-card';
import { RoundsVisitCard } from '@/components/worker/rounds-visit-card';
import { WeekGlance } from '@/components/worker/week-glance';
import { getWorkerLink } from '@/lib/auth/worker-link';
import { getMyJob, getMyJobsInRangeResult, getMyWaitingJobs } from '@/lib/data/worker/jobs';
import { getMyFirstName } from '@/lib/data/worker/profile';
import { getWorkerRoundsExtras } from '@/lib/data/worker/rounds-extras';
import { todayInLondon } from '@/lib/rounds/dates';
import { buildDashboard, dashboardWindow, greetingFor, londonHour } from '@/lib/worker/dashboard';

export default async function WorkerDashboardPage() {
  const link = await getWorkerLink();
  const today = todayInLondon();
  const window = dashboardWindow(today);

  const [range, waiting, firstName, extras] = await Promise.all([
    getMyJobsInRangeResult(window.from, window.to),
    getMyWaitingJobs(),
    getMyFirstName(),
    getWorkerRoundsExtras(),
  ]);
  const data = buildDashboard(range.jobs, today);
  const waitingToday = waiting.filter((j) => j.scheduledDate === today).length;
  // The next job in full, for the customer's number to ring. Read through the same checks as the job page.
  const next = data.today.next && !(data.today.next.status === 'assigned' && !data.today.next.rounds) ? data.today.next : null;
  const nextDetail = next ? await getMyJob(next.id) : null;

  return (
    <div className="space-y-5">
      <PageGradientHeader
        title={greetingFor(londonHour(), firstName)}
        subtitle={`${format(parseISO(today), 'EEEE d MMMM')}${link?.employerName ? ` · working for ${link.employerName}` : ''}`}
      />

      {!range.ok ? (
        <Notice tone="amber" icon={TriangleAlert} title="Couldn't load your jobs">
          Refresh the page to try again. What you see below may be incomplete.
        </Notice>
      ) : null}

      <OffersSection jobs={waiting} employerName={link?.employerName ?? null} limit={3} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start sm:gap-5">
        <div className="space-y-4 sm:space-y-5">
          <DayCard
            plan={data.today}
            nextJobDate={data.numbers.nextJobDate}
            nextDetail={nextDetail}
            waitingToday={waitingToday}
          />
          {extras.employerIsRounds && nextDetail && nextDetail.customerPhone ? (
            <RoundsVisitCard price={nextDetail.price ?? null} phone={nextDetail.customerPhone} accessNotes={nextDetail.accessNotes ?? null} />
          ) : null}
        </div>
        <div className="space-y-4 sm:space-y-5">
          {extras.heldCash ? (
            <CashHeldCard total={extras.heldCash.total} count={extras.heldCash.count} handTo={extras.handToName} />
          ) : null}
          <WeekGlance week={data.week} numbers={data.numbers} />
          <LiteOfferSlot />
        </div>
      </div>
    </div>
  );
}
