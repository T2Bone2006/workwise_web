import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/look/tones';
import { PortalPrintButton } from '@/components/portal/portal-print-button';
import { duration, outcomeFor } from '@/components/portal/portal-job-view';
import type { PortalJobView } from '@/lib/portal/job';
import type { JobReportRow } from '@/lib/jobs/job-report-display';
import type { TimelineEvent } from '@/lib/portal/timeline';
import { formatDay, formatStamp, formatTimeOfDay, minutesBetween, stampParts } from '@/lib/portal/dates';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="break-inside-avoid">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium whitespace-pre-wrap text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * A job as a one-page record the customer can keep: what was asked, what happened, who
 * attended, and the photos. Built to print, so "Save as PDF" gives a clean file.
 */
export function PortalJobReport({
  job,
  tenantName,
  timeline,
  photos,
  reportRows = [],
}: {
  job: PortalJobView;
  tenantName: string;
  timeline: TimelineEvent[];
  photos: Array<{ id: string; url: string; name: string }>;
  reportRows?: JobReportRow[];
}) {
  const outcome = outcomeFor(job);
  const tone = toneClasses(outcome.tone);
  const booked = job.scheduledDate
    ? `${formatDay(job.scheduledDate)}${formatTimeOfDay(job.scheduledTime) ? ` at ${formatTimeOfDay(job.scheduledTime)}` : ''}`
    : null;
  const onSite = minutesBetween(job.arrivedAt, job.completedAt);

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 14mm; } body { background: #fff; } }'}</style>

      <div className="mx-auto mb-4 flex max-w-[800px] items-center justify-between gap-3 px-4 print:hidden">
        <Link
          href={`/portal/jobs/${job.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to the job
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-500 sm:inline">Choose &ldquo;Save as PDF&rdquo; as the destination.</span>
          <PortalPrintButton />
        </div>
      </div>

      <article className="mx-auto max-w-[800px] rounded-2xl bg-white p-8 text-slate-900 shadow-sm print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b border-slate-200 pb-5">
          <div className="min-w-0">
            <p className="text-sm text-slate-500">Job report</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{job.reference}</h1>
            {job.address ? <p className="mt-1 text-sm text-slate-600">{job.address}</p> : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold">{tenantName}</p>
            <p className="mt-1 text-xs text-slate-500">Prepared {formatStamp(new Date().toISOString())}</p>
          </div>
        </header>

        <section
          className={cn('mt-5 break-inside-avoid rounded-xl border-l-4 py-3 pr-4 pl-4 [print-color-adjust:exact]', tone.soft, tone.edge)}
        >
          <h2 className="text-lg font-semibold">{outcome.title}</h2>
          {outcome.body ? <p className="mt-1 text-sm text-slate-700">{outcome.body}</p> : null}
        </section>

        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4">
          {booked ? <Row label="Booked for">{booked}</Row> : null}
          {job.engineerFirstName ? <Row label="Engineer">{job.engineerFirstName}</Row> : null}
          {job.arrivedAt ? <Row label="Engineer arrived">{formatStamp(job.arrivedAt)}</Row> : null}
          {job.completedAt ? <Row label="Completed">{formatStamp(job.completedAt)}</Row> : null}
          {onSite != null ? <Row label="Time on site">{duration(onSite)}</Row> : null}
        </dl>

        <dl className="mt-4 flex flex-col gap-4">
          {job.description ? <Row label="Work requested">{job.description}</Row> : null}
          {job.reason && job.reason !== outcome.body ? <Row label="Why it was not completed">{job.reason}</Row> : null}
          {job.completionNotes ? <Row label="Notes from the engineer">{job.completionNotes}</Row> : null}
        </dl>

        {reportRows.length > 0 ? (
          <section className="mt-7 break-inside-avoid">
            <h2 className="text-sm font-semibold">Engineer&apos;s report</h2>
            <dl className="mt-3 flex flex-col gap-3">
              {reportRows.map((row) => (
                <Row key={row.id} label={row.label}>
                  {row.value}
                </Row>
              ))}
            </dl>
          </section>
        ) : null}

        {timeline.length > 0 ? (
          <section className="mt-7 break-inside-avoid">
            <h2 className="text-sm font-semibold">What happened</h2>
            <ol className="mt-3 flex flex-col gap-2 border-l border-slate-200 pl-4">
              {timeline.map((event) => {
                const parts = stampParts(event.at);
                return (
                  <li key={event.key} className="flex items-baseline justify-between gap-4 text-sm">
                    <span>{event.label}</span>
                    {parts ? <span className="shrink-0 text-xs text-slate-500">{parts.date}, {parts.time}</span> : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {photos.length > 0 ? (
          <section className="mt-7">
            <h2 className="text-sm font-semibold">Photos from the visit</h2>
            <ul className="mt-3 grid grid-cols-3 gap-3">
              {photos.map((photo) => (
                <li key={photo.id} className="break-inside-avoid">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.name} className="aspect-square w-full rounded-lg object-cover" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-500">
          Taken from the job record in WorkWise on the date above. Times are UK time.
        </footer>
      </article>
    </div>
  );
}
