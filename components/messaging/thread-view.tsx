import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import { ReplyActions } from '@/components/messaging/reply-actions';
import { TextCustomerButton } from '@/components/messaging/text-customer-button';
import { CalendarClock, CalendarOff, Check, CheckCheck, Clock, MessageCircle, TriangleAlert, Wallet, type LucideIcon } from 'lucide-react';
import { Avatar, IconChip, Tag, type Tone } from '@/components/look';
import { CONTACT_CHOICE_LABELS } from '@/lib/messaging/channel';
import type { ThreadDetail, ThreadMessage } from '@/lib/data/messaging/threads';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';

const KIND_LABEL: Record<string, string> = {
  reminder: 'Reminder',
  visit_done: 'Visit done',
  chaser: 'Payment reminder',
  payment_received: 'Payment received',
  visit_change: 'Change',
  reply_ack: 'Reply',
};

const CLASS_LABEL: Record<string, string> = {
  said_no: 'Said no',
  asked_move: 'Asked to move',
  question: 'Sent a message',
  opt_out: 'Stopped texts',
  opt_in: 'Started texts',
  other: 'Other',
};

const HANDLED_LABEL: Record<string, string> = {
  skipped: 'Skipped',
  moved: 'Moved',
  kept: 'Kept',
  dismissed: 'Dismissed',
};

function dayWords(ymd: string | null): string | null {
  if (!ymd || !isValidYmd(ymd)) return null;
  return formatVisitDay(ymd);
}

function reviewCopy(
  name: string,
  pending: NonNullable<ThreadDetail['pending']>,
): { title: string; visit: string | null } {
  const who = name.trim().split(/\s+/)[0] || name;
  const visitDay = dayWords(pending.visitDate);
  const asked = dayWords(pending.requestedDate);
  if (pending.aboutPayment === 'says_paid') {
    return { title: `${who} says they've paid`, visit: 'Check your payments, then mark it paid' };
  }
  if (pending.aboutPayment === 'payment_question') {
    return { title: `${who} replied about a payment`, visit: null };
  }
  if (pending.intent === 'said_no') {
    return {
      title: visitDay ? `${who} can't make ${visitDay}` : `${who} said no`,
      visit: visitDay ? `Visit on ${visitDay}` : null,
    };
  }
  if (pending.intent === 'asked_move') {
    return {
      title: asked ? `${who} asked for ${asked}` : `${who} asked to move`,
      visit: visitDay ? `Visit is ${visitDay}` : null,
    };
  }
  return {
    title: `${who} sent a message`,
    visit: visitDay ? `Visit on ${visitDay}` : null,
  };
}

function kindLine(message: ThreadMessage): string | null {
  if (message.direction !== 'outbound') return null;
  const name = KIND_LABEL[message.kind];
  if (!name) return message.channel === 'email' ? 'by email' : null;
  return message.channel === 'email' ? `${name} · by email` : name;
}

function statusLine(message: ThreadMessage): string | null {
  if (message.direction !== 'outbound') return null;
  if (message.status === 'delivered') return 'Delivered';
  if (message.status === 'sent') return 'Sent';
  if (message.status === 'held') return 'Waiting until 7am';
  if (message.status === 'skipped' && message.error === 'opted_out') {
    return 'Skipped: stopped texts';
  }
  if (message.status === 'failed') return 'Not delivered';
  return null;
}

/** How each reply was sorted. WorkWise labels a reply; you decide what happens. */
const LOOKS_LIKE: Record<string, string> = {
  said_no: 'Looks like a no',
  asked_move: 'Looks like a move request',
  question: 'Looks like a question',
};

function londonDay(iso: string): { ymd: string; heading: string; time: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
  return {
    ymd,
    heading: `${get('weekday')} ${Number(get('day'))} ${month}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

const URL_RE = /https?:\/\/[^\s<>]+/g;

function latestHandledChoice(messages: ThreadMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.direction !== 'inbound' || !message.handledAction) continue;
    return HANDLED_LABEL[message.handledAction] ?? null;
  }
  return null;
}

function linkify(body: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(body.slice(last, index));
    const raw = match[0];
    const trimmed = raw.replace(/[.,)]+$/, '');
    const trailing = raw.slice(trimmed.length);
    nodes.push(
      <a
        key={`${index}-${trimmed}`}
        href={trimmed}
        className="underline"
        target="_blank"
        rel="noreferrer"
      >
        {trimmed}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    last = index + raw.length;
  }
  if (last < body.length) nodes.push(body.slice(last));
  return nodes;
}

export function ThreadView(props: {
  detail: ThreadDetail;
  brand: { businessName: string; contactPhone: string | null };
}): JSX.Element {
  const { detail, brand } = props;
  const { customer, pending, messages } = detail;
  const quote =
    (pending ? messages.find((message) => message.id === pending.messageId)?.body : null) ??
    [...messages].reverse().find((message) => message.direction === 'inbound')?.body ??
    null;
  const alreadyHandled = pending ? null : latestHandledChoice(messages);
  const review = pending ? reviewCopy(customer.name, pending) : null;
  const tone: Tone = pending?.aboutPayment
    ? 'emerald'
    : pending?.intent === 'said_no'
      ? 'rose'
      : pending?.intent === 'asked_move'
        ? 'amber'
        : 'rounds';
  const reviewIcon: LucideIcon = pending?.aboutPayment
    ? Wallet
    : pending?.intent === 'said_no'
      ? CalendarOff
      : pending?.intent === 'asked_move'
        ? CalendarClock
        : MessageCircle;

  // Day headings between messages, like any messaging app.
  const days = messages.map((message) => londonDay(message.createdAt));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow)">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={customer.name} tone={tone} size="lg" />
          <div className="min-w-0 space-y-0.5">
            <Link href={`/customers/${customer.id}`} className="text-lg font-semibold hover:underline">
              {customer.name}
            </Link>
            <p className="text-sm text-muted-foreground">
              {customer.phoneDisplay ? <span>{customer.phoneDisplay}</span> : null}
              {customer.phoneDisplay ? ' · ' : null}
              {CONTACT_CHOICE_LABELS[customer.contactChoice]}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {customer.optedOut ? <Tag tone="amber">Stopped texts</Tag> : null}
          <TextCustomerButton phone={customer.phoneDisplay} name={customer.name} />
        </div>
      </div>

      {review && pending ? (
        <section
          aria-label="Needs your choice"
          className="rounded-2xl border bg-card p-4 shadow-(--look-card-shadow) sm:p-5"
          style={{ borderColor: `var(--tone-${tone}-line)` }}
        >
          <div className="flex items-start gap-3">
            <IconChip icon={reviewIcon} tone={tone} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{review.title}</h2>
                {!pending.aboutPayment && LOOKS_LIKE[pending.intent] ? (
                  <Tag tone={tone}>{LOOKS_LIKE[pending.intent]}</Tag>
                ) : null}
              </div>
              {review.visit ? <p className="mt-0.5 text-sm text-muted-foreground">{review.visit}</p> : null}
            </div>
          </div>
          {quote ? (
            <blockquote
              className="mt-4 rounded-r-xl border-l-4 bg-muted/50 px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
              style={{ borderColor: `var(--tone-${tone}-solid)` }}
            >
              {quote}
            </blockquote>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            WorkWise sorted this reply. Nothing changes until you choose.
          </p>
          <div className="mt-3">
            <ReplyActions
              threadId={detail.thread.id}
              customerId={customer.id}
              pending={pending}
              brand={brand}
              customerName={customer.name}
            />
          </div>
        </section>
      ) : alreadyHandled ? (
        <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-4 py-2.5 text-sm text-muted-foreground">
          <Check className="size-4 text-(--tone-emerald-solid)" />
          You chose {alreadyHandled}. Nothing else is waiting here.
        </p>
      ) : null}

      <section
        aria-label="Texts"
        className="rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5"
      >
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <div className="space-y-2.5">
            {messages.map((message, index) => {
              const outbound = message.direction === 'outbound';
              const kind = kindLine(message);
              const status = statusLine(message);
              const handled = message.handledAction ? HANDLED_LABEL[message.handledAction] : null;
              const classification = message.classification ? CLASS_LABEL[message.classification] : null;
              const day = days[index] ?? null;
              const heading = day && day.ymd !== days[index - 1]?.ymd ? day.heading : null;
              const failed = message.status === 'failed' || (message.status === 'skipped' && message.error === 'opted_out');
              const StatusIcon = failed
                ? TriangleAlert
                : message.status === 'delivered'
                  ? CheckCheck
                  : message.status === 'held'
                    ? Clock
                    : Check;
              return (
                <div key={message.id}>
                  {heading ? (
                    <p className="my-3 text-center text-xs font-medium text-muted-foreground">{heading}</p>
                  ) : null}
                  <div className={outbound ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={
                        outbound
                          ? 'max-w-[85%] space-y-1 rounded-2xl rounded-br-md border border-border bg-card px-3.5 py-2.5'
                          : 'max-w-[85%] space-y-1 rounded-2xl rounded-bl-md bg-(--tone-rounds-soft) px-3.5 py-2.5'
                      }
                    >
                      {outbound && kind ? (
                        <p className="text-xs font-medium text-muted-foreground">{kind}</p>
                      ) : null}
                      {!outbound && (classification || handled) ? (
                        <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-(--tone-rounds-text)">
                          {classification}
                          {handled ? <span className="text-muted-foreground">You chose: {handled}</span> : null}
                        </p>
                      ) : null}
                      <p className="text-sm break-words whitespace-pre-wrap">
                        {outbound ? linkify(message.body) : message.body}
                      </p>
                      <p
                        className={
                          'flex items-center gap-1 text-[11px] ' +
                          (failed ? 'font-medium text-(--tone-rose-text)' : 'text-muted-foreground') +
                          (outbound ? ' justify-end' : '')
                        }
                      >
                        {day ? <span className="tabular-nums">{day.time}</span> : null}
                        {outbound && status ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <StatusIcon className="size-3" aria-hidden="true" />
                            {status}
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
