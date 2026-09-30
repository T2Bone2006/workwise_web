'use client';

import { HistoryBackButton } from '@/components/layout/history-back-button';
import { getRememberedPortalJobsListHref } from '@/lib/jobs/jobs-list-query';

export function PortalJobsBackLink() {
  return (
    <HistoryBackButton
      label="Back to all jobs"
      fallbackHref={getRememberedPortalJobsListHref()}
      className="text-muted-foreground"
    />
  );
}
