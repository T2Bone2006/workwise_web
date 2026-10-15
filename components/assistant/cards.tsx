'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Banknote,
  CalendarClock,
  CalendarRange,
  Check,
  CircleAlert,
  Clock,
  Inbox,
  Info,
  Mail,
  MapPin,
  Pause,
  Phone,
  Play,
  Receipt,
  SkipForward,
  Sparkles,
  Tag as TagIcon,
  Undo2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, IconChip, Legend, Tag, toneClasses, type Tone } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import type {
  AssistantAction,
  AssistantCard,
  BarChartCard,
  CustomerCard,
  ListCard,
  MapCard,
  ScheduleCard,
  StatsCard,
} from '@/lib/assistant/shared';
import { WorkingLabel } from '@/components/assistant/thinking';
import { formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';

const RouteMap = dynamic(() => import('./route-map'), {
  ssr: false,
  loading: () => <div className="h-[300px] w-full animate-pulse rounded-xl bg-muted" />,
});

const frame = 'rounded-2xl border border-border bg-card text-card-foreground shadow-(--look-card-shadow)';

function CardHead({ icon, tone, title, aside }: { icon: LucideIcon; tone: Tone; title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconChip icon={icon} tone={tone} size="sm" />
        <h3 className="truncate text-[14px] font-semibold">{title}</h3>
      </div>
      {aside ? <div className="shrink-0 text-xs text-muted-foreground">{aside}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatsView({ card }: { card: StatsCard }) {
  return (
    <div className={cn(frame, 'p-3')}>
      {card.title ? <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">{card.title}</p> : null}
      <div className={cn('grid gap-2', card.items.length >= 3 ? 'grid-cols-3' : card.items.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {card.items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-xl bg-muted/50 px-3 py-2.5">
            <p className="truncate text-xs text-muted-foreground">{item.label}</p>
            <p className={cn('mt-1 truncate text-xl font-semibold tracking-tight tabular-nums', toneClasses(item.tone ?? 'slate').figure)}>
              {item.value}
            </p>
            {item.hint ? <p className="truncate text-[11px] text-muted-foreground">{item.hint}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Chart colours as real colour values. SVG fill attributes can't read CSS
 * variables, so the tone tokens are looked up from the page once mounted
 * (they follow light/dark and the new look). Falls back to the brand colours.
 */
const TONE_FALLBACK: Record<string, string> = { emerald: '#059669', rose: '#E11D48', sky: '#0C66E4', rounds: '#0C66E4', lite: '#9B30D9', amber: '#D97706', teal: '#0F766E', violet: '#7C3AED', indigo: '#4F46E5', slate: '#64748B' };

function useToneColours(tones: string[]): Record<string, string> {
  const key = tones.join(',');
  // Cards only ever render in the browser (answers arrive after the page loads), so the page's styles are there to read.
  return useMemo(() => {
    const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
    return Object.fromEntries(key.split(',').map((t) => [t, style?.getPropertyValue(`--tone-${t}-solid`).trim() || TONE_FALLBACK[t] || '#0C66E4']));
  }, [key]);
}

function BarChartView({ card }: { card: BarChartCard }) {
  const colours = useToneColours(card.series.map((s) => s.tone));
  const money = card.series.some((s) => s.key === 'in' || s.key === 'out');
  const data = card.points.map((p) => ({ label: p.label, ...p.values }));
  return (
    <div className={frame}>
      <CardHead icon={CalendarRange} tone={card.series[0]?.tone ?? 'sky'} title={card.title} aside={<Legend items={card.series.map((s) => ({ label: s.label, tone: s.tone }))} />} />
      <div className="h-[220px] px-2 pb-3 text-foreground">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tick={{ fill: 'currentColor', opacity: 0.6 }} interval={0} />
            <YAxis
              width={money ? 52 : 28}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tick={{ fill: 'currentColor', opacity: 0.6 }}
              tickFormatter={(v: number) => (money ? formatGbp(v) : String(v))}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
              formatter={(value, name) => [money ? formatGbp(Number(value)) : String(value), card.series.find((s) => s.key === name)?.label ?? String(name)]}
              contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 12 }}
            />
            {card.series.map((s) => (
              <Bar key={s.key} dataKey={s.key} fill={colours[s.tone]} radius={[4, 4, 0, 0]} maxBarSize={28} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RowShell({ href, children }: { href?: string; children: React.ReactNode }) {
  const cls = cn('flex items-center gap-3 px-4 py-2.5', href && rowHover);
  return href ? (
    <Link href={href} className={cn(cls, 'focus-visible:outline-none')}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function ListView({ card }: { card: ListCard }) {
  return (
    <div className={cn(frame, 'overflow-hidden')}>
      <CardHead icon={card.total?.tone === 'rose' ? Banknote : Inbox} tone={card.total?.tone ?? 'sky'} title={card.title} aside={`${card.items.length}${card.footer ? '+' : ''}`} />
      <ul className="divide-y divide-border border-t border-border">
        {card.items.map((item, i) => (
          <li key={item.id ?? `${item.title}-${i}`}>
            <RowShell href={item.href}>
              {card.people ? (
                <Avatar name={item.title} size="sm" tone={item.tone ?? 'slate'} />
              ) : (
                <span className={cn('size-2 shrink-0 rounded-full', toneClasses(item.tone ?? 'slate').solid)} aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                {item.subtitle ? <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p> : null}
              </div>
              {item.tag ? <Tag tone={item.tone === 'rose' ? 'amber' : (item.tone ?? 'slate')}>{item.tag}</Tag> : null}
              {item.amount ? (
                <span className={cn('shrink-0 text-sm font-semibold tabular-nums', item.tone ? toneClasses(item.tone).figure : '')}>{item.amount}</span>
              ) : null}
            </RowShell>
          </li>
        ))}
      </ul>
      {card.total || card.footer ? (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5 text-sm">
          <span className="text-xs text-muted-foreground">{card.footer ?? ''}</span>
          {card.total ? (
            <span className="font-medium">
              {card.total.label}{' '}
              <span className={cn('font-semibold tabular-nums', toneClasses(card.total.tone ?? 'slate').figure)}>{card.total.value}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const STOP_DOT: Record<string, string> = {
  to_do: 'bg-(--tone-sky-solid)',
  done: 'bg-(--tone-emerald-solid)',
  skipped: 'bg-(--tone-slate-solid)',
  other: 'bg-(--tone-slate-solid)',
};

function ScheduleView({ card }: { card: ScheduleCard }) {
  return (
    <div className={cn(frame, 'overflow-hidden')}>
      <CardHead
        icon={CalendarClock}
        tone="sky"
        title={card.title}
        aside={<Legend items={[{ label: 'To do', tone: 'sky' }, { label: 'Done', tone: 'emerald' }, { label: 'Skipped', tone: 'slate' }]} />}
      />
      <div className="divide-y divide-border border-t border-border">
        {card.days.map((day) => (
          <section key={day.date}>
            <div className="flex items-baseline justify-between gap-3 bg-muted/40 px-4 py-2">
              {day.href ? (
                <Link href={day.href} className="text-[13px] font-semibold hover:underline">
                  {day.label}
                </Link>
              ) : (
                <p className="text-[13px] font-semibold">{day.label}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {day.stops.length} {day.stops.length === 1 ? 'visit' : 'visits'} · <span className="font-medium text-foreground tabular-nums">{day.total}</span>
              </p>
            </div>
            <ol>
              {day.stops.map((stop, i) => (
                <li key={stop.id} className={cn('flex items-center gap-3 px-4 py-2', stop.status === 'skipped' && 'opacity-60')}>
                  <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className={cn('size-2 shrink-0 rounded-full', STOP_DOT[stop.status])} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium', stop.status === 'skipped' && 'line-through')}>{stop.customer}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {stop.service}
                      {stop.address ? `, ${stop.address}` : ''}
                    </p>
                  </div>
                  {stop.time ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{stop.time}</span> : null}
                  {stop.amount ? <span className="shrink-0 text-sm tabular-nums">{stop.amount}</span> : null}
                  {stop.status === 'done' ? <Check className="size-4 shrink-0 text-(--tone-emerald-solid)" aria-label="Done" /> : null}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      {card.footer ? <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{card.footer}</p> : null}
    </div>
  );
}

function MapView({ card }: { card: MapCard }) {
  return (
    <div className={frame}>
      <CardHead
        icon={MapPin}
        tone="sky"
        title={card.title}
        aside={
          card.date ? (
            <Legend items={[{ label: 'To do', tone: 'sky' }, { label: 'Done', tone: 'emerald' }, { label: 'Skipped', tone: 'slate' }]} />
          ) : card.stops.some((s) => s.status === 'other') ? (
            <Legend items={[{ label: 'Paid up', tone: 'sky' }, { label: 'Owes money', tone: 'slate' }]} />
          ) : (
            `${card.stops.length} ${card.stops.length === 1 ? 'place' : 'places'}`
          )
        }
      />
      <div className="px-3 pb-3">
        <RouteMap stops={card.stops} numbered={Boolean(card.date)} />
        {card.approximate ? (
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {card.approximate} {card.approximate === 1 ? 'stop is' : 'stops are'} placed by postcode area only, as the full postcode wasn&apos;t found. Worth checking the address.
          </p>
        ) : null}
        {card.missing > 0 ? (
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {card.missing} {card.missing === 1 ? 'stop has' : 'stops have'} no map position, so {card.missing === 1 ? "it isn't" : "they aren't"} shown.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CustomerView({ card }: { card: CustomerCard }) {
  return (
    <div className={cn(frame, 'overflow-hidden')}>
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <Avatar name={card.name} tone="rounds" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={card.href} className="truncate text-[15px] font-semibold hover:underline">
              {card.name}
            </Link>
            {!card.active ? <Tag tone="slate">Inactive</Tag> : null}
            {card.owed ? <Tag tone="rose">Owes {card.owed}</Tag> : null}
            {card.credit ? <Tag tone="emerald">{card.credit} credit</Tag> : null}
          </div>
          {card.address ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{card.address}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {card.phone ? (
              <a href={`tel:${card.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                <Phone className="size-3" aria-hidden /> {card.phone}
              </a>
            ) : null}
            {card.email ? (
              <a href={`mailto:${card.email}`} className="inline-flex items-center gap-1 truncate hover:text-foreground">
                <Mail className="size-3" aria-hidden /> {card.email}
              </a>
            ) : null}
          </div>
        </div>
      </div>
      {card.services.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {card.services.map((s, i) => (
            <li key={`${s.title}-${i}`} className={cn('flex items-center gap-3 px-4 py-2', s.status === 'ended' && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.often}
                  {s.next ? `, next ${s.next}` : ''}
                </p>
              </div>
              {s.status === 'paused' ? <Tag tone="amber">Paused</Tag> : s.status === 'ended' ? <Tag tone="slate">Ended</Tag> : null}
              <span className="shrink-0 text-sm font-semibold tabular-nums">{s.price}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-4 border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" aria-hidden /> Last visit {card.lastVisit ?? 'none yet'}
        </span>
        <span>Next {card.nextVisit ?? 'none booked'}</span>
      </div>
    </div>
  );
}

export function CardView({ card }: { card: AssistantCard }) {
  switch (card.type) {
    case 'stats':
      return <StatsView card={card} />;
    case 'bar_chart':
      return <BarChartView card={card} />;
    case 'list':
      return <ListView card={card} />;
    case 'schedule':
      return <ScheduleView card={card} />;
    case 'map':
      return <MapView card={card} />;
    case 'customer':
      return <CustomerView card={card} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The Do it / Cancel card

const ACTION_ICON: Record<string, LucideIcon> = {
  move_visits: CalendarClock,
  move_day: CalendarRange,
  skip_visits: SkipForward,
  record_payment: Banknote,
  add_expense: Receipt,
  add_customer: UserPlus,
  pause_service: Pause,
  resume_service: Play,
  change_price: TagIcon,
  send_pay_link: Mail,
  set_lead_status: Inbox,
  update_pricing: Sparkles,
};

const RAIL: Record<Tone, string> = {
  sky: 'before:bg-(--tone-sky-solid)',
  emerald: 'before:bg-(--tone-emerald-solid)',
  rose: 'before:bg-(--tone-rose-solid)',
  amber: 'before:bg-(--tone-amber-solid)',
  indigo: 'before:bg-(--tone-indigo-solid)',
  teal: 'before:bg-(--tone-teal-solid)',
  violet: 'before:bg-(--tone-violet-solid)',
  rounds: 'before:bg-(--tone-rounds-solid)',
  lite: 'before:bg-(--tone-lite-solid)',
  slate: 'before:bg-(--tone-slate-solid)',
};

export function ActionCardView({
  action,
  onDecide,
}: {
  action: AssistantAction;
  onDecide: (decision: 'confirm' | 'cancel' | 'undo') => void;
}) {
  const Icon = ACTION_ICON[action.kind] ?? Sparkles;
  const pending = action.status === 'pending';
  const running = action.status === 'running';
  const done = action.status === 'done';
  const closed = action.status === 'cancelled' || action.status === 'expired' || action.status === 'undone';
  const tone: Tone = done ? 'emerald' : action.status === 'failed' ? 'rose' : closed ? 'slate' : action.tone;

  return (
    <div
      className={cn(
        frame,
        'relative overflow-hidden pl-1 before:absolute before:inset-y-0 before:left-0 before:w-1',
        RAIL[tone],
        closed && 'opacity-75',
      )}
      aria-live="polite"
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <IconChip icon={done ? Check : Icon} tone={tone} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn('text-[15px] leading-snug font-semibold', closed && 'line-through decoration-muted-foreground/50')}>{action.title}</p>
              {done ? <Tag tone="emerald">Done</Tag> : null}
              {action.status === 'undone' ? <Tag tone="slate">Undone</Tag> : null}
              {action.status === 'cancelled' ? <Tag tone="slate">Cancelled</Tag> : null}
              {action.status === 'expired' ? <Tag tone="slate">Expired</Tag> : null}
              {action.status === 'failed' ? <Tag tone="rose">Didn&apos;t work</Tag> : null}
            </div>
            {pending || running ? (
              <ul className="mt-2 space-y-1">
                {action.lines.map((line, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/85">
                    <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', toneClasses(action.tone).solid)} aria-hidden />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {(done || action.status === 'undone') && action.result ? <p className="mt-1 text-sm text-muted-foreground">{action.result}</p> : null}
            {action.status === 'expired' ? <p className="mt-1 text-sm text-muted-foreground">This was a while ago. Ask again if you still want it.</p> : null}
            {action.error ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-(--tone-rose-text)">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {action.error}
              </p>
            ) : null}
            {(pending || running) && action.note ? (
              <p className="mt-2.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden /> {action.note}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {pending || running ? (
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-2.5">
          <button
            type="button"
            disabled={running}
            onClick={() => onDecide('cancel')}
            className="rounded-xl px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => onDecide('confirm')}
            className={cn(
              'inline-flex min-w-28 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-80',
              toneClasses(action.tone).solid,
            )}
          >
            {running ? <WorkingLabel /> : action.confirmLabel}
          </button>
        </div>
      ) : done && (action.canUndo || action.href) ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
          {action.href ? (
            <Link href={action.href} className="rounded-xl px-3 py-1.5 text-sm font-medium text-(--tone-rounds-text) hover:bg-muted">
              Have a look
            </Link>
          ) : null}
          {action.canUndo ? (
            <button
              type="button"
              onClick={() => onDecide('undo')}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Undo2 className="size-3.5" aria-hidden /> Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
