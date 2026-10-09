import { ListChecks } from 'lucide-react';
import { LookCard } from '@/components/look';
import { detectFieldLink } from '@/lib/worker/field-link';

/** The fields the employer chose to show this worker. A phone number, email or link is tappable. */
export function JobSheetCard({ rows }: { rows: ReadonlyArray<{ label: string; value: string }> }) {
  if (rows.length === 0) return null;
  return (
    <LookCard title="Job sheet" icon={ListChecks} tone="indigo">
      <dl className="divide-y divide-border">
        {rows.map((row, index) => {
          const link = detectFieldLink(row.value);
          return (
            <div key={`${row.label}-${index}`} className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 text-sm font-medium break-words whitespace-pre-line">
                {link ? (
                  <a
                    href={link.href}
                    {...(link.kind === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="text-(--tone-rounds-text) underline-offset-4 hover:underline"
                  >
                    {row.value}
                  </a>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </LookCard>
  );
}
