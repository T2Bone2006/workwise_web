'use client';

import type { ReactNode } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  JOB_STATUS_DISPLAY,
  type JobStatusUi,
} from '@/lib/job-status-display';
import { SKIP_REASON_LABELS, type SkipReason } from '@/lib/rounds/skip-reasons';
import type { VisitRow } from '@/lib/data/rounds/visits';
import type { SmsBrand } from '@/lib/messaging/templates';
import { VisitActionButtons } from '@/components/rounds/visit-actions';

const priceFormat = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

/** Accent bar + soft wash so the row reads the visit status at a glance. */
const STATUS_ACCENT: Record<
  string,
  { bar: string; wash: string; glow: string }
> = {
  completed: {
    bar: 'bg-emerald-500',
    wash: 'from-emerald-500/[0.08] via-transparent to-transparent dark:from-emerald-400/[0.12]',
    glow: 'rgb(16 185 129)',
  },
  cancelled: {
    bar: 'bg-rose-500',
    wash: 'from-rose-500/[0.08] via-transparent to-transparent dark:from-rose-400/[0.12]',
    glow: 'rgb(244 63 94)',
  },
  in_progress: {
    bar: 'bg-blue-500',
    wash: 'from-blue-500/[0.10] via-transparent to-transparent dark:from-blue-400/[0.14]',
    glow: 'rgb(59 130 246)',
  },
  en_route: {
    bar: 'bg-blue-500',
    wash: 'from-blue-500/[0.10] via-transparent to-transparent dark:from-blue-400/[0.14]',
    glow: 'rgb(59 130 246)',
  },
  arrived: {
    bar: 'bg-blue-500',
    wash: 'from-blue-500/[0.10] via-transparent to-transparent dark:from-blue-400/[0.14]',
    glow: 'rgb(59 130 246)',
  },
  paused: {
    bar: 'bg-amber-600',
    wash: 'from-amber-600/[0.10] via-transparent to-transparent dark:from-amber-500/[0.14]',
    glow: 'rgb(180 83 9)',
  },
  assigned: {
    bar: 'bg-amber-500',
    wash: 'from-amber-500/[0.08] via-transparent to-transparent dark:from-amber-400/[0.12]',
    glow: 'rgb(245 158 11)',
  },
  accepted: {
    bar: 'bg-amber-500',
    wash: 'from-amber-500/[0.08] via-transparent to-transparent dark:from-amber-400/[0.12]',
    glow: 'rgb(245 158 11)',
  },
};

const FALLBACK_ACCENT = STATUS_ACCENT.assigned;

function roundsStatusKey(status: string): JobStatusUi {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'completed';
  if (status === 'paused') return 'paused';
  if (
    status === 'in_progress' ||
    status === 'en_route' ||
    status === 'arrived'
  ) {
    return 'in_progress';
  }
  if (status === 'declined') return 'declined';
  if (status === 'incomplete') return 'incomplete';
  return 'assigned';
}

function roundsStatusLabel(status: string): string {
  if (status === 'cancelled') return 'Skipped';
  if (status === 'completed') return 'Done';
  if (status === 'assigned' || status === 'accepted') return 'Planned';
  return JOB_STATUS_DISPLAY[roundsStatusKey(status)]?.label ?? status;
}

function VisitStatusBadge({ status }: { status: string }) {
  const key = roundsStatusKey(status);
  const meta = JOB_STATUS_DISPLAY[key];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide',
        meta?.badgeClass
      )}
    >
      {roundsStatusLabel(status)}
    </span>
  );
}

const PAYMENT_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  paid: {
    label: 'Paid',
    className:
      'border-emerald-300/65 bg-gradient-to-br from-emerald-100/90 to-teal-50/70 text-emerald-950 dark:border-emerald-700/40 dark:from-emerald-950/40 dark:to-teal-950/20 dark:text-emerald-200',
  },
  partial: {
    label: 'Part paid',
    className:
      'border-amber-300/65 bg-gradient-to-br from-amber-100/90 to-yellow-50/70 text-amber-950 dark:border-amber-700/40 dark:from-amber-950/40 dark:to-yellow-950/20 dark:text-amber-200',
  },
  unpaid: {
    label: 'Unpaid',
    className:
      'border-rose-300/65 bg-gradient-to-br from-rose-100/90 to-red-50/70 text-rose-900 dark:border-rose-800/40 dark:from-rose-950/40 dark:to-red-950/20 dark:text-rose-200',
  },
  waived: {
    label: 'Waived',
    className:
      'border-slate-300/65 bg-gradient-to-br from-slate-100/90 to-slate-50/70 text-slate-700 dark:border-slate-600/40 dark:from-slate-800/45 dark:to-slate-900/30 dark:text-slate-200',
  },
};

/** Only a done visit can be owed; on a planned one "Unpaid" read like the customer was behind. */
function PaymentStatusBadge({
  status,
  visitStatus,
}: {
  status: string | null;
  visitStatus: string;
}) {
  if (!status || visitStatus !== 'completed') return null;
  const meta = PAYMENT_STATUS_BADGE[status];
  if (!meta) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide backdrop-blur-sm',
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}

function skipLabel(reason: string | null): string | null {
  if (!reason) return null;
  if (reason in SKIP_REASON_LABELS) {
    return SKIP_REASON_LABELS[reason as SkipReason];
  }
  return reason.replace(/_/g, ' ');
}

export function VisitStopCard({
  visit,
  visits,
  orderIndex,
  leading,
  className,
  dimmed,
  brand,
}: {
  visit: VisitRow;
  /** Other services at the same house on this day, including `visit`. */
  visits?: VisitRow[];
  /** 1-based stop number when the day is ordered. */
  orderIndex?: number | null;
  /** Optional drag / reorder controls (day plan). */
  leading?: ReactNode;
  className?: string;
  dimmed?: boolean;
  brand: SmsBrand;
}) {
  const services = visits && visits.length > 0 ? visits : [visit];
  const several = services.length > 1;
  const amount = services.reduce((sum, row) => {
    if (row.status === 'cancelled') return sum;
    return sum + (row.final_amount ?? row.quoted_amount ?? 0);
  }, 0);
  const accent = STATUS_ACCENT[visit.status] ?? FALLBACK_ACCENT;
  const time = services
    .map((row) => row.scheduled_time?.slice(0, 5))
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const place = [visit.address, visit.postcode].filter(Boolean).join(', ');
  const skippedWhy = visit.status === 'cancelled' ? skipLabel(visit.skip_reason) : null;
  const position = orderIndex ?? visit.route_position;

  return (
    <li
      className={cn(
        'group relative list-none overflow-hidden rounded-2xl border border-border/70',
        'bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]',
        'transition-all duration-200 sm:hover:-translate-y-0.5 sm:hover:shadow-[var(--shadow-glow-sm-value)]',
        'dark:border-white/[0.06]',
        dimmed && 'opacity-60',
        className
      )}
    >
      <div
        className={cn('pointer-events-none absolute inset-y-0 left-0 w-1', accent.bar)}
        aria-hidden
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-r',
          accent.wash
        )}
        aria-hidden
      />

      <div className="relative flex flex-col gap-3 p-3 pl-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:p-4 sm:pl-5">
        <div className="flex min-w-0 flex-1 gap-2.5 sm:gap-3">
          {leading}
          {position != null ? (
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold tabular-nums sm:size-9"
              style={{
                borderColor: accent.glow.replace(')', ' / 0.45)'),
                backgroundColor: accent.glow.replace(')', ' / 0.12)'),
                color: accent.glow,
              }}
              aria-label={`Stop ${position}`}
            >
              {position}
            </div>
          ) : null}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <p className="text-[15px] font-semibold tracking-tight text-foreground sm:text-base">
                {visit.customer_name ?? 'Customer'}
              </p>
              <VisitStatusBadge status={visit.status} />
              {several ? null : (
                <PaymentStatusBadge status={visit.payment_status} visitStatus={visit.status} />
              )}
              {amount != null ? (
                <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
                  {priceFormat.format(amount)}
                </span>
              ) : null}
            </div>
            <p className="text-sm leading-snug text-foreground/80">
              {several
                ? services
                    .map((row) => row.job_description)
                    .filter(Boolean)
                    .join(' · ')
                : visit.job_description}
            </p>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
              {time ? (
                <span className="inline-flex items-center gap-1 font-medium text-foreground/70">
                  <Clock className="size-3.5 shrink-0" />
                  {time}
                  {visit.estimated_duration_minutes
                    ? ` · ${visit.estimated_duration_minutes} min`
                    : null}
                </span>
              ) : null}
              {place ? (
                <span className="inline-flex min-w-0 items-start gap-1">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  <span className="break-words">{place}</span>
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{visit.reference_number}</span>
              {skippedWhy ? (
                <span className="text-rose-700/90 dark:text-rose-300/90">
                  · {skippedWhy}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="w-full space-y-2 sm:w-auto sm:shrink-0 sm:pt-0.5">
          {services.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2">
              {several ? (
                <p className="min-w-0 text-sm text-foreground">
                  {row.job_description}
                  <span className="ml-2 tabular-nums text-muted-foreground">
                    {priceFormat.format(row.final_amount ?? row.quoted_amount ?? 0)}
                  </span>
                </p>
              ) : null}
              {several ? (
                <PaymentStatusBadge status={row.payment_status} visitStatus={row.status} />
              ) : null}
              <VisitActionButtons
                jobId={row.id}
                status={row.status}
                quotedAmount={row.quoted_amount}
                scheduledDate={row.scheduled_date}
                scheduledTime={row.scheduled_time}
                customerSendsInvoice={row.customer_sends_invoice}
                customerHasEmail={row.customer_has_email}
                brand={brand}
              />
            </div>
          ))}
        </div>
      </div>
    </li>
  );
}
