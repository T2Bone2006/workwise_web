import { format, parseISO } from 'date-fns';
import { History } from 'lucide-react';
import { LookCard } from '@/components/look';

/** What has happened to the job, oldest first. */
export function JobHistoryCard({ lines }: { lines: ReadonlyArray<{ at: string; label: string }> }) {
  if (lines.length === 0) return null;
  return (
    <LookCard title="History" icon={History} tone="slate">
      <ol className="space-y-3">
        {lines.map((line, index) => (
          <li key={`${line.at}-${index}`} className="flex gap-3 text-sm">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-(--tone-slate-solid)" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">{line.label}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{format(parseISO(line.at), 'EEE d MMM, HH:mm')}</p>
            </div>
          </li>
        ))}
      </ol>
    </LookCard>
  );
}
