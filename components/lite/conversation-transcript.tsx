import type { StoredMessage } from '@/lib/widget/conversation';
import { Tag } from '@/components/look';
import { cn } from '@/lib/utils';

const TAG_LABEL: Record<string, string> = {
  lead: 'Lead',
  booking: 'Booking',
  firm_price: 'Firm price',
  guide_price: 'Guide price',
  visit_offered: 'Visit offered',
  out_of_area: 'Out of area',
  question_only: 'Question only',
  no_details: 'No details',
  off_topic: 'Off topic',
};

export function londonWhen(iso: string): { dayMonth: string; hm: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  if (!/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return null;
  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
  }).format(date);
  return { dayMonth, hm: `${hour}:${minute}` };
}

function tagLabel(tag: string): string {
  return TAG_LABEL[tag] ?? tag;
}

export function ConversationTranscript({
  summary,
  tags,
  messages,
  status,
  className,
}: {
  className?: string;
  summary: string | null;
  tags: string[];
  messages: StoredMessage[];
  status: 'active' | 'ended';
}) {
  const seen = new Set<string>();
  const chips = tags.filter((tag) => {
    if (seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });

  return (
    <div className={cn('space-y-4', className ?? 'mt-3')}>
      {summary ? <p className="text-sm font-semibold">{summary}</p> : null}
      {status === 'active' || chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {status === 'active' ? (
            <li>
              <Tag tone="lite">Still chatting</Tag>
            </li>
          ) : null}
          {chips.map((tag) => (
            <li key={tag}>
              <Tag tone="slate">{tagLabel(tag)}</Tag>
            </li>
          ))}
        </ul>
      ) : null}
      {messages.length > 0 ? (
        <ol className="space-y-3">
          {messages.map((message, index) => {
            const theirs = message.role === 'user';
            const when = message.at ? londonWhen(message.at) : null;
            return (
              <li key={`${message.at}-${index}`} className={cn('flex', theirs ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] min-w-0', theirs ? 'items-end' : 'items-start')}>
                  <p className={cn('mb-1 text-xs text-muted-foreground', theirs ? 'text-right' : 'text-left')}>
                    {theirs ? 'Them' : 'Assistant'}
                    {when ? ` · ${when.hm}` : ''}
                  </p>
                  <p
                    className={cn(
                      'rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap',
                      theirs
                        ? 'rounded-br-md border border-border bg-card'
                        : 'rounded-bl-md bg-(--tone-lite-soft) text-foreground',
                    )}
                  >
                    {message.content}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
