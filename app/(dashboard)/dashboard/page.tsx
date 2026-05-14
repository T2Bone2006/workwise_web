import { getTenantIdForCurrentUser, getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { getDashboardJobStatCards, getRecentJobs } from '@/lib/data/dashboard';
import { DashboardStatCards } from '@/components/dashboard/dashboard-stat-cards';
import { RecentJobs } from '@/components/dashboard/recent-jobs';
import { DeclinedJobsBanner } from '@/components/jobs/declined-jobs-banner';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const tenantId = await getTenantIdForCurrentUser();
  const tenantName = await getTenantNameForCurrentUser();

  if (!tenantId) {
    redirect('/login');
  }

  const [jobStats, recentJobs] = await Promise.all([
    getDashboardJobStatCards(tenantId),
    getRecentJobs(tenantId, 8),
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageGradientHeader title="Dashboard" subtitle={tenantName ?? undefined} />
      <DeclinedJobsBanner />

      <section className="shrink-0">
        <DashboardStatCards stats={jobStats} />
      </section>

      <section className="min-h-0 flex-1">
        <RecentJobs jobs={recentJobs} />
      </section>
    </div>
  );
}
