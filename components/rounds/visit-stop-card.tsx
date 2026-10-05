'use client';

import type { ReactNode } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { Tag, toneClasses } from '@/components/look';
import { cn } from '@/lib/utils';
import { JOB_STATUS_DISPLAY, type JobStatusUi } from '@/lib/job-status-display';
import { SKIP_REASON_LABELS, type SkipReason } from '@/lib/rounds/skip-reasons';
import type { VisitRow } from '@/lib/data/rounds/visits';
import type { SmsBrand } from '@/lib/messaging/templates';
import { VisitActionButtons } from '@/components/rounds/visit-actions';

const priceFormat = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

type AccentTone = 'emerald' | 'rose' | 'sky' | 'amber' | 'slate';

/** The visit's status as a colour: bar, number bubble and tag all follow it (same as the phone). */
const STATUS_TONE: Record<string, AccentTone> = {
  completed: 'emerald',
  cancelled: 'rose',
  in_progress: 'sky',
  en_route: 'sky',
  arrived: 'sky',
  paused: 'amber',
  assigned: 'slate',
  accepted: 'slate',
};

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

function VisitStatusBadge({ status, next = false }: { status: string; next?: boolean }) {
  if (next) return <Tag tone="sky">Next</Tag>;
  return <Tag tone={STATUS_TONE[status] ?? 'slate'}>{roundsStatusLabel(status)}</Tag>;
}

const PAYMENT_STATUS_BADGE: Record<string, { label: string; tone: AccentTone }> = {
  paid: { label: 'Paid', tone: 'emerald' },
  partial: { label: 'Part paid', tone: 'amber' },
  unpaid: { label: 'Unpaid', tone: 'rose' },
  waived: { label: 'Waived', tone: 'slate' },
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
  return <Tag tone={meta.tone}>{meta.label}</Tag>;
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
  isNext,
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
  /** The next stop still to do (blue, like the phone). */
  isNext?: boolean;
  brand: SmsBrand;
}) {
  const services = visits && visits.length > 0 ? visits : [visit];
  const several = services.length > 1;
  const amount = services.reduce((sum, row) => {
    if (row.status === 'cancelled') return sum;
    return sum + (row.final_amount ?? row.quoted_amount ?? 0);
  }, 0);
  const tone: AccentTone = isNext && (visit.status === 'assigned' || visit.status === 'accepted') ? 'sky' : (STATUS_TONE[visit.status] ?? 'slate');
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
        'group relative list-none overflow-hidden rounded-2xl border border-border bg-card shadow-(--look-card-shadow)',
        'transition-shadow duration-200 sm:hover:shadow-md',
        dimmed && 'opacity-60',
        className
      )}
    >
      <div
        className={cn('pointer-events-none absolute inset-y-0 left-0 w-1', toneClasses(tone).solid)}
        aria-hidden
      />

      <div className="relative flex flex-col gap-3 p-3 pl-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:p-4 sm:pl-5">
        <div className="flex min-w-0 flex-1 gap-2.5 sm:gap-3">
          {leading}
          {position != null ? (
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold tabular-nums sm:size-9"
              style={{
                borderColor: `color-mix(in srgb, var(--tone-${tone}-solid) 45%, transparent)`,
                backgroundColor: `var(--tone-${tone}-soft)`,
                color: `var(--tone-${tone}-text)`,
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
              <VisitStatusBadge status={visit.status} next={tone === 'sky' && visit.status !== 'in_progress'} />
              {several ? null : (
                <PaymentStatusBadge status={visit.payment_status} visitStatus={visit.status} />
              )}
              {amount != null ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
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
                <span className="text-(--tone-rose-text)">
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
