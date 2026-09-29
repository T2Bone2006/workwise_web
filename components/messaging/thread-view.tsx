import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import { ReplyActions } from '@/components/messaging/reply-actions';
import { TextCustomerButton } from '@/components/messaging/text-customer-button';
import { Card, CardContent } from '@/components/ui/card';
import { CONTACT_CHOICE_LABELS } from '@/lib/messaging/channel';
import type { ThreadDetail, ThreadMessage } from '@/lib/data/messaging/threads';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';

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
  const accent =
    pending?.intent === 'said_no' ? 'bg-rose-500' : pending?.intent === 'asked_move' ? 'bg-amber-500' : 'bg-sky-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/customers/${customer.id}`}
            className="text-lg font-semibold hover:underline"
          >
            {customer.name}
          </Link>
          <p className="text-sm text-muted-foreground">
            {customer.phoneDisplay ? <span>{customer.phoneDisplay}</span> : null}
            {customer.phoneDisplay ? ' · ' : null}
            {CONTACT_CHOICE_LABELS[customer.contactChoice]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {customer.optedOut ? (
            <span className="inline-flex rounded-full border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200">
              Stopped texts
            </span>
          ) : null}
          <TextCustomerButton phone={customer.phoneDisplay} name={customer.name} />
        </div>
      </div>

      {review ? (
        <Card className="glass-card relative overflow-hidden border-border/80">
          <div className={cn('absolute inset-y-0 left-0 w-1', accent)} aria-hidden />
          <CardContent className="space-y-4 pl-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{review.title}</h2>
              {review.visit ? <p className="mt-0.5 text-sm text-muted-foreground">{review.visit}</p> : null}
            </div>
            {quote ? (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">&ldquo;{quote}&rdquo;</p>
            ) : null}
            {pending ? (
              <ReplyActions
                threadId={detail.thread.id}
                customerId={customer.id}
                pending={pending}
                brand={brand}
                customerName={customer.name}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : alreadyHandled ? (
        <p className="text-sm text-muted-foreground">You chose {alreadyHandled}.</p>
      ) : null}

      <h2 className="text-sm font-semibold text-foreground">Texts</h2>
      <Card className="glass-card border-border/80">
        <CardContent className="space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            messages.map((message) => {
              const outbound = message.direction === 'outbound';
              const kind = kindLine(message);
              const status = statusLine(message);
              const handled = message.handledAction
                ? HANDLED_LABEL[message.handledAction]
                : null;
              const classification = message.classification
                ? CLASS_LABEL[message.classification]
                : null;
              return (
                <div
                  key={message.id}
                  className={outbound ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={
                      outbound
                        ? 'max-w-[85%] space-y-1 rounded-xl bg-primary/10 px-3 py-2'
                        : 'max-w-[85%] space-y-1 rounded-xl bg-muted px-3 py-2'
                    }
                  >
                    {outbound && (kind || status) ? (
                      <p className="text-xs text-muted-foreground">
                        {kind}
                        {kind && status ? ' · ' : null}
                        {status}
                      </p>
                    ) : null}
                    {!outbound && (classification || handled) ? (
                      <p className="text-xs text-muted-foreground">
                        {classification}
                        {handled ? `${classification ? ' · ' : ''}You chose: ${handled}` : null}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {outbound ? linkify(message.body) : message.body}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
