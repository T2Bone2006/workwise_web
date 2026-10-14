import type { JobReportRow } from '@/lib/jobs/job-report-display';

export function JobReportRows({ rows }: { rows: JobReportRow[] }) {
  if (rows.length === 0) return null;

  return (
    <dl className="space-y-3">
      {rows.map((row) =>
        row.multiline ? (
          <div key={row.id} className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
            <dd className="whitespace-pre-wrap text-sm text-foreground">{row.value}</dd>
          </div>
        ) : (
          <div
            key={row.id}
            className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3"
          >
            <dt className="shrink-0 text-xs font-medium text-muted-foreground">{row.label}</dt>
            <dd className="text-sm text-foreground">{row.value}</dd>
          </div>
        )
      )}
    </dl>
  );
}
