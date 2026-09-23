'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getRememberedPortalJobsListHref } from '@/lib/jobs/jobs-list-query';
import { Button } from '@/components/ui/button';

export function PortalJobsBackLink() {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" asChild>
      <Link href={getRememberedPortalJobsListHref()}>
        <ArrowLeft className="size-4" />
        Back to all jobs
      </Link>
    </Button>
  );
}
