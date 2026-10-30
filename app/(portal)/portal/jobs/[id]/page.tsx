import { FileQuestionMark } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { EmptyState } from '@/components/look/empty-state';
import { PortalJobPage } from '@/components/portal/portal-job-view';
import { PortalJobsBackLink } from '@/components/portal/portal-jobs-back-link';
import { loadPortalJob } from '@/lib/data/portal';

interface PortalJobDetailPageProps {
  params: Promise<{ id: string }>;
}

function NoAccess({ title, subtitle, body }: { title: string; subtitle: string; body: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageGradientHeader title={title} subtitle={subtitle} />
      <PortalJobsBackLink />
      <EmptyState icon={FileQuestionMark} title={title} body={body} />
    </div>
  );
}

export default async function PortalJobDetailPage({ params }: PortalJobDetailPageProps) {
  const { id: jobId } = await params;
  const loaded = await loadPortalJob(jobId);

  if (loaded.status === 'signed_out') redirect('/login');
  if (loaded.status === 'no_link') {
    return (
      <NoAccess
        title="Job not found"
        subtitle="You do not have access to this job."
        body="Your account is not linked to a customer, so this job cannot be opened."
      />
    );
  }
  if (loaded.status === 'not_found') {
    return (
      <NoAccess
        title="Job not found"
        subtitle="This job does not exist or you do not have permission to view it."
        body="This job does not exist, or it belongs to a different customer."
      />
    );
  }

  return (
    <PortalJobPage
      back={<PortalJobsBackLink />}
      job={loaded.job}
      tenantName={loaded.tenantName}
      timeline={loaded.timeline}
      photos={loaded.photos}
      documents={loaded.documents}
      reportRows={loaded.reportRows}
    />
  );
}
