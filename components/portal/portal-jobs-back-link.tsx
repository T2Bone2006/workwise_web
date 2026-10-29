'use client';

import { HistoryBackButton } from '@/components/layout/history-back-button';
import { getRememberedPortalJobsListHref } from '@/lib/jobs/jobs-list-query';

export function PortalJobsBackLink() {
  return (
    <HistoryBackButton
      label="Back"
      fallbackHref={getRememberedPortalJobsListHref()}
      className="text-muted-foreground"
    />
  );
}
