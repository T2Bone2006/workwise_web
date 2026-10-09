import Link from 'next/link';
import { Ban, CalendarCheck, CircleCheck, TriangleAlert } from 'lucide-react';
import { EmptyState } from '@/components/look';
import { JobRow } from '@/components/worker/job-row';
import { cn } from '@/lib/utils';
import type { JobsTab, WorkerJob } from '@/lib/worker/types';

const EMPTY: Record<JobsTab, { icon: typeof CircleCheck; title: string; body?: string }> = {
  upcoming: { icon: CalendarCheck, title: 'No jobs coming up', body: 'When your manager gives you a job it will show here.' },
  done: { icon: CircleCheck, title: 'Nothing done yet', body: 'Jobs you finish are kept here.' },
  not_completed: { icon: CircleCheck, title: 'Nothing here, and that is good', body: 'Jobs that could not be finished show here with the reason.' },
  declined: { icon: Ban, title: "You haven't declined any jobs" },
};

function pageHref(tab: JobsTab, page: number): string {
  return page <= 1 ? `/worker/jobs?tab=${tab}` : `/worker/jobs?tab=${tab}&page=${page}`;
}

/** The jobs on one tab, with Newer / Older links when there is more than a page. */
export function JobsList({
  jobs,
  tab,
  page,
  hasMore,
  ok,
}: {
  jobs: readonly WorkerJob[];
  tab: JobsTab;
  page: number;
  hasMore: boolean;
  ok: boolean;
}) {
  if (!ok && jobs.length === 0) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Couldn't load this"
        body="Refresh the page to try again. This is not the same as having no jobs."
      />
    );
  }
  if (jobs.length === 0) {
    const empty = EMPTY[tab];
    return <EmptyState icon={empty.icon} title={empty.title} body={empty.body} />;
  }
  const link =
    'rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobRow job={job} lead="day" reason={tab === 'not_completed' ? job.notBecause : null} />
          </li>
        ))}
      </ul>
      {page > 1 || hasMore ? (
        <nav aria-label="More jobs" className={cn('flex items-center gap-2', page > 1 && hasMore ? 'justify-between' : page > 1 ? 'justify-start' : 'justify-end')}>
          {page > 1 ? (
            <Link href={pageHref(tab, page - 1)} className={link}>
              Newer
            </Link>
          ) : null}
          {hasMore ? (
            <Link href={pageHref(tab, page + 1)} className={link}>
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
