import type { JSX } from 'react';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';
import type { ReplyLabel } from '@/lib/data/messaging/threads';
import { cn } from '@/lib/utils';

function dayLabel(ymd: string | null): string | null {
  if (!ymd || !isValidYmd(ymd)) return null;
  return formatVisitDay(ymd);
}

export function ReplyLabelBadge(props: { label: ReplyLabel | null }): JSX.Element | null {
  const { label } = props;
  if (!label) return null;

  if (label.kind === 'said_no') {
    return <Chip className="border-rose-300/70 bg-rose-50 text-rose-900 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-200">Said no</Chip>;
  }

  if (label.kind === 'asked_move') {
    const day = dayLabel(label.requestedDate);
    return (
      <Chip className="border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200">
        {day ? `Asked for ${day}` : 'Asked to move'}
      </Chip>
    );
  }

  return (
    <Chip className="border-sky-300/70 bg-sky-50 text-sky-900 dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-200">
      Sent a message
    </Chip>
  );
}

function Chip({ className, children }: { className: string; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}
