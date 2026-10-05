import Link from 'next/link';
import { formatJobWhenShort } from '@/lib/lite/job-when';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { BoardLead } from '@/lib/data/lite/leads-board';
import { Tag, type Tone } from '@/components/look';
import { litePaths } from '@/lib/navigation/lite-paths';
import { cn } from '@/lib/utils';

export function formatPounds(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return `£${rounded}`;
  return `£${rounded.toFixed(2)}`;
}

export function quoteLabel(quote: BoardLead['quote']): string | null {
  if (!quote) return null;
  if (quote.kind === 'firm' && typeof quote.amount === 'number') return formatPounds(quote.amount);
  if (quote.kind === 'guide' && typeof quote.min === 'number' && typeof quote.max === 'number') {
    return `${formatPounds(quote.min)}–${formatPounds(quote.max)}`;
  }
  if (quote.kind === 'visit') return 'Free visit';
  return null;
}

/** Price on a card: the agreed amount once there is one, otherwise what was offered. */
export function cardPrice(lead: BoardLead): string | null {
  if (typeof lead.agreedAmount === 'number') return formatPounds(lead.agreedAmount);
  return quoteLabel(lead.quote);
}

export function timeAgo(iso: string, now = new Date()): string {
  const delta = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 60_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const PROBLEM: Record<NonNullable<BoardLead['flags']['followUpProblem']>, string> = {
  out_of_texts: 'Out of texts',
  opted_out: "They've opted out",
  failed: "Didn't send",
  stuck: "Didn't send",
};

function Badge({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  return (
    <span title={title}>
      <Tag tone={tone} className="py-0.5 text-[11px]">
        {children}
      </Tag>
    </span>
  );
}

export function LeadCard({
  lead,
  menu,
  className,
  dragging,
  locked,
  handleRef,
  handleProps,
  style,
}: {
  lead: BoardLead;
  menu?: ReactNode;
  className?: string;
  dragging?: boolean;
  locked?: boolean;
  handleRef?: (node: HTMLElement | null) => void;
  handleProps?: HTMLAttributes<HTMLElement>;
  style?: CSSProperties;
}) {
  const price = cardPrice(lead);
  const problem = lead.flags.followUpProblem;
  const badges = [
    lead.bookingStatus === 'requested' ? (
      <Badge key="request" tone="amber">
        Booking request
      </Badge>
    ) : null,
    lead.decidedBy === 'auto' && lead.bookingStatus === 'accepted' ? (
      <Badge key="auto" tone="rounds">
        Auto-accepted
      </Badge>
    ) : null,
    problem ? (
      <Badge key="problem" tone="rose" title={PROBLEM[problem]}>
        Follow-up not sent
      </Badge>
    ) : null,
    lead.flags.replied ? (
      <Badge key="replied" tone="violet">
        Replied
      </Badge>
    ) : null,
    lead.flags.converted ? (
      <Badge key="round" tone="emerald">
        On your round
      </Badge>
    ) : null,
  ].filter(Boolean);

  return (
    <article
      ref={handleRef}
      style={style}
      title={locked ? 'Accept or decline the booking first' : undefined}
      className={cn(
        'rounded-xl bg-card px-3 py-2.5 shadow-(--look-card-shadow) ring-1 ring-border',
        locked ? 'cursor-not-allowed' : handleProps ? 'cursor-grab touch-none active:cursor-grabbing' : undefined,
        dragging && 'opacity-40',
        className,
      )}
      {...handleProps}
    >
      <div className="flex items-start gap-2">
        <Link
          href={litePaths.lead(lead.id)}
          draggable={false}
          className="min-w-0 flex-1 rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold" title={lead.name}>
              {lead.name}
            </span>
            {price ? <span className="shrink-0 text-sm font-medium tabular-nums">{price}</span> : null}
          </span>
          {lead.jobSummary ? (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground" title={lead.jobSummary}>
              {lead.jobSummary}
            </span>
          ) : null}
          {lead.status === 'won' && lead.bookedForDate ? (
            <span className="mt-1 block text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {formatJobWhenShort(lead.bookedForDate, lead.bookedForTime)}
            </span>
          ) : (
            <span className="mt-1 block text-xs text-muted-foreground">{timeAgo(lead.createdAt)}</span>
          )}
        </Link>
        {menu}
      </div>
      {badges.length > 0 ? <p className="mt-2 flex flex-wrap gap-1.5">{badges}</p> : null}
    </article>
  );
}
