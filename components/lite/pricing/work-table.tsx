import type { JobType } from '@/lib/lite/profile-schema';

function pounds(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return `£${rounded}`;
  return `£${rounded.toFixed(2)}`;
}

function usualPrice(job: JobType): string {
  if (job.how_priced === 'needs_visit') return 'Needs a look first';
  if (job.guide_min != null && job.guide_max != null) return `${pounds(job.guide_min)}–${pounds(job.guide_max)}`;
  return 'Needs a look first';
}

/** How each kind of work is priced. Auto-accept is hidden for launch (lead capture only). */
export function WorkTable({ jobs }: { jobs: JobType[] }) {
  return (
    <ul className="space-y-3">
      {jobs.map((job) => {
        const visit = job.how_priced === 'needs_visit';
        return (
          <li key={job.key} className="space-y-2 rounded-xl border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{job.name}</p>
                <p className="text-sm">
                  {visit
                    ? 'The chat will not give a firm price. It asks them to leave their details so you can look first.'
                    : `The chat gives an estimate from what the customer describes. Usual price ${usualPrice(job)}.`}
                </p>
              </div>
              <PriceBadge visit={visit} />
            </div>
            {!visit && job.what_changes_price ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">What pushes the price up: </span>
                {job.what_changes_price}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function PriceBadge({ visit }: { visit: boolean }) {
  return (
    <span
      className={
        visit
          ? 'inline-flex rounded-full bg-(--tone-amber-soft) px-2 py-0.5 text-xs font-medium text-(--tone-amber-text)'
          : 'inline-flex rounded-full bg-(--tone-emerald-soft) px-2 py-0.5 text-xs font-medium text-(--tone-emerald-text)'
      }
    >
      {visit ? 'Needs a look' : 'From a description'}
    </span>
  );
}
