import { PageTabs, type PageTabItem } from '@/components/look';
import { JobsList } from '@/components/worker/jobs-list';
import { LiteOfferSlot } from '@/components/worker/lite-offer-slot';
import { getMyJobsHistory } from '@/lib/data/worker/jobs';
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
  const result = await getMyJobsHistory({ tab, page });

  return (
    <div className="space-y-4 sm:space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">Jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">What is coming up, and everything you have done.</p>
      </header>
      <PageTabs items={TABS} active={tab} ariaLabel="Jobs" />
      <JobsList jobs={result.jobs} tab={tab} page={page} hasMore={result.hasMore} ok={result.ok} />
      <LiteOfferSlot />
    </div>
  );
}
