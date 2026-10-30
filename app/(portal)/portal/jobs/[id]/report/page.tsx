import { redirect } from 'next/navigation';
import { PortalJobReport } from '@/components/portal/portal-job-report';
import { loadPortalJob } from '@/lib/data/portal';

export default async function PortalJobReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPortalJob(id);

  if (loaded.status === 'signed_out') redirect('/login');
  if (loaded.status !== 'ok') {
    return (
      <div className="mx-auto max-w-md p-10 text-center text-sm text-slate-600">
        This job does not exist, or you do not have access to it.
      </div>
    );
  }

  return <PortalJobReport job={loaded.job} tenantName={loaded.tenantName} timeline={loaded.timeline} photos={loaded.photos} reportRows={loaded.reportRows} />;
}
