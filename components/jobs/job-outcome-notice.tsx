import { AlertTriangle, Mail, UserPlus, XCircle } from 'lucide-react';
import { Notice } from '@/components/look';
import { Button } from '@/components/ui/button';
import type { JobOutcomeSummary } from '@/lib/jobs/job-outcome-summary';

/**
 * The first thing a dispatcher needs on a job that didn't go to plan: what
 * happened and why, in one place, with the two things they can do next.
 * New look only; the same facts are in the report and the history below.
 */
export function JobOutcomeNotice({ summary }: { summary: JobOutcomeSummary }) {
  const declined = summary.outcome === 'declined';
  const who = summary.workerName ?? 'The worker';
  const meta = [summary.workerName, summary.endedAt ?? summary.scheduled].filter(Boolean).join(' · ');

  return (
    <Notice
      tone={declined ? 'rose' : 'amber'}
      icon={declined ? AlertTriangle : XCircle}
      title={declined ? `${who} declined this job` : 'This job was not completed'}
      action={
        <div className="flex flex-wrap gap-2">
          {declined ? (
            <Button asChild size="sm">
              <a href="#assignment">
                <UserPlus className="mr-1.5 size-4" aria-hidden="true" />
                Pick another worker
              </a>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <a href="#email">
              <Mail className="mr-1.5 size-4" aria-hidden="true" />
              Email about this job
            </a>
          </Button>
        </div>
      }
    >
      {summary.reason ? <span className="font-medium text-foreground">&ldquo;{summary.reason}&rdquo;</span> : 'No reason was given.'}
      {meta ? <span className="mt-1 block">{meta}</span> : null}
    </Notice>
  );
}
