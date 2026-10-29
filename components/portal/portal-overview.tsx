import Link from 'next/link';
import { CalendarDays, ChevronRight, CircleCheck, Clock, Gauge, ImageIcon, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconChip, LookPage, Notice, StatTile, Tag } from '@/components/look';
import { toneClasses } from '@/components/look/tones';
import { formatDay, formatStamp } from '@/lib/portal/dates';
import { type AttentionItem, type PortalOverviewData, type PortalWeek } from '@/lib/portal/overview';


export function jobHref(id: string, tenant?: string): string {
  return tenant ? `/portal/jobs/${id}?tenant=${tenant}` : `/portal/jobs/${id}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/* ------------------------------------------------------------------ */
/* Needs your attention                                                */
/* ------------------------------------------------------------------ */

function AttentionThumb({ item }: { item: AttentionItem }) {
  if (item.photoUrl) {
    return (
      <span className="relative block size-20 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-24">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.photoUrl} alt="" className="size-full object-cover" loading="lazy" />
        {item.photoCount > 1 ? (
          <span className="absolute right-1 bottom-1 inline-flex items-center gap-0.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
            <ImageIcon className="size-3" aria-hidden />
            {item.photoCount}
          </span>
        ) : null}
      </span>
    );
  }
  const overdue = item.kind === 'overdue';
  const Icon = overdue ? Clock : TriangleAlert;
  return (
    <span
      className={cn(
        'flex size-20 shrink-0 items-center justify-center rounded-xl sm:size-24',
        toneClasses(overdue ? 'amber' : 'rose').soft,
        toneClasses(overdue ? 'amber' : 'rose').text,
      )}
      aria-hidden
    >
      <Icon className="size-7" />
    </span>
  );
}

export function AttentionRow({ item, tenant }: { item: AttentionItem; tenant?: string }) {
  const overdue = item.kind === 'overdue';
  const happened = formatStamp(item.happenedAt);
  return (
    <li>
      <Link
        href={jobHref(item.id, tenant)}
        className={cn(
          'group flex items-center gap-3.5 rounded-xl border border-border bg-card p-3 shadow-(--look-card-shadow) transition-colors sm:gap-4 sm:p-3.5',
          overdue ? 'hover:border-(--tone-amber-solid)/50' : 'hover:border-(--tone-rose-solid)/50',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        )}
      >
        <AttentionThumb item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {overdue ? (
              <Tag tone="amber">
                {item.daysLate} {plural(item.daysLate, 'day', 'days')} late
              </Tag>
            ) : (
              <Tag tone="rose">Not completed</Tag>
            )}
            <span className="text-xs text-muted-foreground">
              {overdue && item.scheduledDate ? `Was booked for ${formatDay(item.scheduledDate)}` : happened}
            </span>
          </div>
          <p className="mt-1.5 text-[15px] leading-snug font-semibold">{item.reference}</p>
          {item.address ? <p className="line-clamp-2 text-sm text-muted-foreground">{item.address}</p> : null}
          {overdue ? (
            <p className="mt-1.5 text-sm text-muted-foreground">The visit hasn&apos;t started yet and its booked day has passed.</p>
          ) : item.reason ? (
            <p className="mt-1.5 line-clamp-3 text-sm">{item.reason}</p>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">No reason was written down for this visit.</p>
          )}
        </div>
        <ChevronRight className="hidden size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

export function PortalAttention({
  items,
  total,
  doneThisWeek,
  tenant,
}: {
  items: AttentionItem[];
  total: number;
  doneThisWeek: number;
  tenant?: string;
}) {
  if (items.length === 0) {
    return (
      <Notice tone="emerald" icon={CircleCheck} title="Nothing needs your attention">
        {doneThisWeek > 0
          ? `${doneThisWeek} ${plural(doneThisWeek, 'job was', 'jobs were')} completed this week. Jobs that fail or run late will show up here first.`
          : 'Jobs that fail or run late will show up here first.'}
      </Notice>
    );
  }

  const hasFailed = items.some((i) => i.kind === 'not_completed');
  const tone = hasFailed ? 'rose' : 'amber';
  const classes = toneClasses(tone);

  return (
    <section className={cn('rounded-2xl border p-3 sm:p-4', classes.border, classes.soft)} aria-labelledby="needs-attention">
      <div className="mb-3 flex items-center gap-2.5 px-1">
        <IconChip icon={TriangleAlert} tone={tone} size="sm" />
        <h2 id="needs-attention" className="text-[15px] font-semibold">
          Needs your attention
        </h2>
        <span className={cn('rounded-full bg-card px-2 py-0.5 text-xs font-semibold tabular-nums', classes.text)}>{total}</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <AttentionRow key={item.id} item={item} tenant={tenant} />
        ))}
      </ul>
      {total > items.length ? (
        <p className="mt-3 px-1 text-sm text-muted-foreground">
          {total - items.length} more.{' '}
          <Link href={attentionHref({}, tenant)} className="font-medium text-foreground underline underline-offset-2">
            See all {total}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The numbers: each one opens the table below, already filtered        */
/* ------------------------------------------------------------------ */

export function attentionHref(params: Record<string, string>, tenant?: string): string {
  const query = new URLSearchParams(params);
  if (tenant) query.set('tenant', tenant);
  const qs = query.toString();
  return qs ? `/portal/attention?${qs}` : '/portal/attention';
}

function jobsHref(params: Record<string, string>, tenant?: string): string {
  const query = new URLSearchParams(params);
  if (tenant) query.set('tenant', tenant);
  const qs = query.toString();
  return qs ? `/portal/jobs?${qs}` : '/portal/jobs';
}

export function PortalWeekTiles({ week, tenant }: { week: PortalWeek; tenant?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Overdue"
        value={String(week.overdue)}
        sub={week.overdue > 0 ? 'Booked day passed, no visit' : 'None overdue'}
        tone={week.overdue > 0 ? 'amber' : 'slate'}
        icon={Clock}
        href={week.overdue > 0 ? attentionHref({ kind: 'overdue' }, tenant) : undefined}
      />
      <StatTile
        label="Not completed"
        value={String(week.notCompleted)}
        sub={week.notCompleted > 0 ? 'Visited, could not finish' : 'None open'}
        tone={week.notCompleted > 0 ? 'rose' : 'slate'}
        icon={TriangleAlert}
        href={week.notCompleted > 0 ? attentionHref({ kind: 'not_completed' }, tenant) : undefined}
      />
      <StatTile
        label="Booked this week"
        value={String(week.booked)}
        sub={
          week.booked > 0
            ? `${week.done} done · ${formatDay(week.start)} to ${formatDay(week.end)}`
            : `${formatDay(week.start)} to ${formatDay(week.end)}`
        }
        tone="indigo"
        icon={CalendarDays}
        href={jobsHref({ date_from: week.start, date_to: week.end }, tenant)}
      />
      <StatTile
        label="Completion rate"
        value={week.completionRate == null ? '—' : `${week.completionRate}%`}
        sub={
          week.completionRate == null
            ? 'No finished visits in 30 days'
            : `Last 30 days, ${week.finishedLast30} ${plural(week.finishedLast30, 'visit', 'visits')}`
        }
        tone={week.completionRate == null ? 'slate' : 'emerald'}
        icon={Gauge}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The whole home page                                                 */
/* ------------------------------------------------------------------ */

export function PortalHome({
  tenantName,
  data,
  tenant,
  actions,
}: {
  tenantName: string;
  data: PortalOverviewData;
  /** Set when there is more than one provider, so links stay on the same one. */
  tenant?: string;
  /** Beside the title: the provider switcher when there is more than one. */
  actions?: React.ReactNode;
}) {
  const summary =
    data.attentionTotal > 0
      ? `${data.attentionTotal} ${plural(data.attentionTotal, 'job needs', 'jobs need')} your attention.`
      : 'Everything is on track.';

  return (
    <LookPage title="Overview" subtitle={`Work raised with ${tenantName}. ${summary}`} actions={actions}>
      <PortalWeekTiles week={data.week} tenant={tenant} />
      <PortalAttention items={data.attention} total={data.attentionTotal} doneThisWeek={data.week.done} tenant={tenant} />
      <p className="text-sm text-muted-foreground">
        Looking for a particular job?{' '}
        <Link href={jobsHref({}, tenant)} className="font-medium text-foreground underline underline-offset-2">
          Browse all jobs
        </Link>
      </p>
    </LookPage>
  );
}
