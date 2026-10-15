import { textLabel, type LeadText } from '@/lib/data/lite/lead-detail';
import { MessageSquare } from 'lucide-react';
import { LookCard } from '@/components/look';
import { cn } from '@/lib/utils';

const TONE = {
  emerald: 'text-emerald-700 dark:text-emerald-300',
  sky: 'text-sky-700 dark:text-sky-300',
  amber: 'text-amber-800 dark:text-amber-200',
  rose: 'text-rose-700 dark:text-rose-300',
  slate: 'text-slate-500 dark:text-slate-400',
  violet: 'text-violet-700 dark:text-violet-300',
} as const;

function showsBody(text: LeadText): boolean {
  if (text.kind === 'owner_alert' || !text.body) return false;
  return text.status === 'sent' || text.status === 'emailed' || text.status === 'received';
}

export function TextsTimeline({ texts, firstName }: { texts: LeadText[]; firstName: string }) {
  return (
    <LookCard title="Texts" icon={MessageSquare} tone="lite">
      {texts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No texts for this lead.</p>
      ) : (
        <ol className="space-y-4">
          {texts.map((text) => {
            const label = textLabel(text, firstName);
            const reply = text.kind === 'reply_in';
            return (
              <li key={text.id} className={cn('flex flex-col gap-1', reply ? 'items-end text-right' : 'items-start')}>
                <p className="text-sm font-medium">{label.title}</p>
                <p className={cn('text-sm', TONE[label.tone])}>{label.status}</p>
                {showsBody(text) ? (
                  <p
                    className={cn(
                      'max-w-full rounded-2xl px-3.5 py-2.5 text-left text-sm whitespace-pre-wrap',
                      reply ? 'rounded-br-md border border-border bg-card' : 'rounded-bl-md bg-muted',
                    )}
                  >
                    {text.body}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </LookCard>
  );
}
