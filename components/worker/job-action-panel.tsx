import Link from 'next/link';
import { CalendarCheck, CircleHelp, Play } from 'lucide-react';
import { Notice } from '@/components/look';
import { JobResponse } from '@/components/worker/job-response';
import { Button } from '@/components/ui/button';
import { APP_DOWNLOAD_PATH } from '@/lib/app-stores';
import { UNDERWAY_STATUSES } from '@/lib/worker/status';
import { canRespond } from '@/lib/worker/respond';
import type { WorkerJobDetail } from '@/lib/worker/types';

function GetTheApp() {
  return (
    <Button asChild variant="outline" className="h-10 bg-card">
      <Link href={APP_DOWNLOAD_PATH}>Get the app</Link>
    </Button>
  );
}

/**
 * What the worker needs to do with this job, said once, at the top of the page. A new job asks for an answer
 * (Accept, Decline). An accepted or running job points to the app, which is where it is started and finished.
 * A finished or declined job needs nothing, so nothing shows.
 */
export function JobActionPanel({ job, employerName }: { job: WorkerJobDetail; employerName: string | null }) {
  if (job.declinedByMe) return null;

  if (canRespond(job)) {
    return (
      <Notice
        tone="sky"
        icon={CircleHelp}
        title="Can you take this job?"
        action={<JobResponse jobId={job.id} jobTitle={job.title} employerName={employerName} goToAfterDecline="/worker/jobs" />}
      >
        {employerName ? `${employerName} has sent it to you.` : 'It has been sent to you.'} Accept it to put it on your calendar, or decline and it goes
        back to them.
      </Notice>
    );
  }

  if (job.rounds) return null;

  if (job.status === 'accepted') {
    return (
      <Notice tone="emerald" icon={CalendarCheck} title="You've accepted this job" action={<GetTheApp />}>
        It is on your calendar. When you get there, start it in the WorkWise app. Photos and the report are done there too.
      </Notice>
    );
  }

  if (UNDERWAY_STATUSES.has(job.status)) {
    return (
      <Notice tone="sky" icon={Play} title="This job is under way" action={<GetTheApp />}>
        Photos, the report and finishing it are done in the WorkWise app. Open it on your phone to carry on.
      </Notice>
    );
  }

  return null;
}
