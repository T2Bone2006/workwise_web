import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { PageTabs, type PageTabItem } from '@/components/look';
import { JobsList } from '@/components/worker/jobs-list';
import { LiteOfferSlot } from '@/components/worker/lite-offer-slot';
import { OffersSection } from '@/components/worker/offer-card';
import { getWorkerLink } from '@/lib/auth/worker-link';
import { getMyJobsHistory, getMyWaitingJobs } from '@/lib/data/worker/jobs';
import { getWorkerRoundsExtras } from '@/lib/data/worker/rounds-extras';
import { todayInLondon } from '@/lib/rounds/dates';
import { parseJobsTab, type JobsTab } from '@/lib/worker/types';

interface PageProps {
  searchParams: Promise<{ tab?: string; page?: string }>;
}

const TABS: PageTabItem<JobsTab>[] = [
  { key: 'upcoming', label: 'Upcoming', href: '/worker/jobs?tab=upcoming' },
  { key: 'done', label: 'Done', href: '/worker/jobs?tab=done' },
  { key: 'not_completed', label: 'Not completed', href: '/worker/jobs?tab=not_completed' },
  { key: 'declined', label: 'Declined', href: '/worker/jobs?tab=declined' },
];

export default async function WorkerJobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = parseJobsTab(params.tab);
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const showOffers = tab === 'upcoming' && page === 1;

  const [result, waiting, link, extras] = await Promise.all([
    getMyJobsHistory({ tab, page }),
    showOffers ? getMyWaitingJobs() : Promise.resolve([]),
    getWorkerLink(),
    getWorkerRoundsExtras(),
  ]);
  // A job waiting for an answer is shown above with Accept and Decline, so it is not repeated in the list.
  const waitingIds = new Set(waiting.map((j) => j.id));
  const jobs = result.jobs.filter((j) => !waitingIds.has(j.id));
  const noun = extras.employerIsRounds ? 'Visits' : 'Jobs';

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageGradientHeader title={noun} subtitle="What is coming up, and everything you have done." />
      <PageTabs items={TABS} active={tab} ariaLabel={noun} />
      {showOffers ? <OffersSection jobs={waiting} employerName={link?.employerName ?? null} /> : null}
      {jobs.length === 0 && waiting.length > 0 && result.ok ? null : (
        <JobsList jobs={jobs} tab={tab} page={page} hasMore={result.hasMore} ok={result.ok} today={todayInLondon()} />
      )}
      <LiteOfferSlot />
    </div>
  );
}
