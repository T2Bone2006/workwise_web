'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { decideFromLinkAction } from '@/app/lead/[token]/actions';
import { Button } from '@/components/ui/button';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { BusinessMark, PublicFrame, Tag } from '@/components/look';
import { Checkbox } from '@/components/ui/checkbox';
import type { LeadLinkLead, LeadLinkView } from '@/lib/lite/lead-link-view';
import { litePaths } from '@/lib/navigation/lite-paths';
import { cn } from '@/lib/utils';

const PRICE_ERROR = 'Enter a price between £1 and £50,000.';
const SAVE_FAILED = "Couldn't save that. Try again.";

const DAY_LABELS: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const HIGHLIGHT = 'ring-2 ring-(--tone-lite-solid) ring-offset-2 ring-offset-background';

export function LeadPageFrame(props: { children: React.ReactNode }) {
  return <PublicFrame>{props.children}</PublicFrame>;
}

export function LeadLinkMessage(props: { title: string; body?: string }) {
  return (
    <div className="space-y-4 rounded-3xl border border-border bg-card p-6 text-center shadow-(--look-card-shadow)">
      <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground" aria-hidden="true">
        <CircleAlert className="size-5" />
      </span>
      <p className="text-base font-semibold text-balance">{props.title}</p>
      {props.body ? <p className="text-sm text-muted-foreground text-balance">{props.body}</p> : null}
      <Button asChild className="h-11 w-full rounded-full">
        <Link href="/login?next=/lite">Log in to WorkWise</Link>
      </Button>
    </div>
  );
}

function gbp(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return `£${rounded}`;
  return `£${rounded.toFixed(2)}`;
}

function poundsInput(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

function priceOffered(lead: LeadLinkLead): string | null {
  if (lead.quoteKind === 'firm' && lead.quoteAmount != null) return gbp(lead.quoteAmount);
  if (lead.quoteKind === 'guide' && lead.quoteMin != null && lead.quoteMax != null) {
    return `${gbp(lead.quoteMin)}\u2013${gbp(lead.quoteMax)}`;
  }
  if (lead.quoteKind === 'visit') return 'Free look-and-quote visit';
  return null;
}

function acceptLabel(lead: LeadLinkLead): string {
  if (lead.quoteKind === 'firm' && lead.quoteAmount != null) return `Accept \u2013 ${gbp(lead.quoteAmount)}`;
  return 'Accept the visit';
}

function daysLabel(days: string[]): string | null {
  const keys = days.map((day) => day.trim().toLowerCase()).filter((day) => day !== '');
  if (keys.length === 0) return null;
  if (keys.includes('any')) return 'Any day';
  const labels = DAY_ORDER.filter((key) => keys.includes(key)).map((key) => DAY_LABELS[key] ?? key);
  return labels.length > 0 ? labels.join(', ') : null;
}

function telHref(display: string): string | null {
  const digits = display.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

function formatWhen(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Europe/London',
  })
    .format(date)
    .replace(/\u202f/g, ' ')
    .toLowerCase();
  return `${day} at ${time}`;
}

function decidedSentence(lead: LeadLinkLead): string {
  if (lead.bookingStatus === 'none') {
    return "There's nothing to decide on this one — open WorkWise to see the lead.";
  }
  const when = lead.decidedAt ? formatWhen(lead.decidedAt) : null;
  const on = when ? ` on ${when}` : '';
  if (lead.bookingStatus === 'declined') return `You declined this${on}.`;
  const amount = lead.agreedAmount ?? (lead.quoteKind === 'firm' ? lead.quoteAmount : null);
  const price = amount != null ? ` \u2013 ${gbp(amount)}` : '';
  if (lead.decidedBy === 'auto') return `Auto-accepted${on}${price}.`;
  return `You accepted this${on}${price}.`;
}

function parsePounds(raw: string): number | null {
  const cleaned = raw.replace(/£/g, '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 1 || amount > 50000) return null;
  return amount;
}

function LeadSummary(props: { lead: LeadLinkLead }) {
  const { lead } = props;
  const href = lead.mobileDisplay ? telHref(lead.mobileDisplay) : null;
  const rows: Array<{ label: string; value: string }> = [];
  if (lead.jobSummary) rows.push({ label: 'Job', value: lead.jobSummary });
  const price = priceOffered(lead);
  if (price) rows.push({ label: 'Price offered', value: price });
  if (lead.postcode) rows.push({ label: 'Postcode', value: lead.postcode });
  const days = daysLabel(lead.preferredDays);
  if (days) rows.push({ label: 'Days that suit', value: days });
  if (lead.note) rows.push({ label: 'Their note', value: lead.note });

  return (
    <div className="min-w-0">
      <p className="text-2xl font-semibold tracking-tight break-words">{lead.fullName}</p>
      {lead.mobileDisplay ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="min-w-0 text-base break-words">{lead.mobileDisplay}</p>
          {href ? (
            <a
              href={href}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-full border border-(--tone-lite-solid) px-5 text-sm font-semibold text-(--tone-lite-text)"
            >
              Call
            </a>
          ) : null}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <dl className="mt-4">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-border py-3"
            >
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd className="text-right text-sm font-medium break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function LeadDecidedPanel(props: { lead: LeadLinkLead; leadId: string }) {
  const accepted = props.lead.bookingStatus === 'accepted';
  return (
    <div className="space-y-3">
      <div
        className={cn(
          'flex items-start gap-3 rounded-2xl border px-4 py-3.5',
          accepted
            ? 'border-(--tone-emerald-line) bg-(--tone-emerald-soft)'
            : 'border-(--tone-slate-line) bg-(--tone-slate-soft)',
        )}
        role="status"
      >
        <CircleCheck
          className={cn('mt-0.5 size-5 shrink-0', accepted ? 'text-(--tone-emerald-solid)' : 'text-(--tone-slate-text)')}
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-balance">{decidedSentence(props.lead)}</p>
      </div>
      <Button asChild variant="outline" className="h-11 w-full rounded-full">
        <Link href={litePaths.lead(props.leadId)}>Open in WorkWise</Link>
      </Button>
    </div>
  );
}

function DecisionButtons(props: {
  token: string;
  lead: LeadLinkLead;
  intent: 'accept' | 'change' | 'decline' | null;
  onDone: (view: LeadLinkView) => void;
}) {
  const { lead, intent } = props;
  const [price, setPrice] = useState(lead.quoteAmount != null ? poundsInput(lead.quoteAmount) : '');
  const [tell, setTell] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const changeRef = useRef<HTMLDivElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const firm = lead.quoteKind === 'firm' && lead.quoteAmount != null;

  useEffect(() => {
    const target =
      intent === 'accept' ? acceptRef.current : intent === 'change' ? changeRef.current : intent === 'decline' ? declineRef.current : null;
    target?.scrollIntoView({ block: 'center' });
    if (intent === 'change') priceRef.current?.focus();
  }, [intent]);

  async function submit(decision: 'accept' | 'decline' | 'change_price', amount?: number) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await decideFromLinkAction({
        token: props.token,
        decision,
        ...(amount != null ? { amount } : {}),
        ...(decision === 'decline' ? { tellCustomer: tell } : {}),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (result.view.state === 'open') {
        setError(SAVE_FAILED);
        return;
      }
      props.onDone(result.view);
    } catch {
      setError(SAVE_FAILED);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  function changePrice() {
    const amount = parsePounds(price);
    if (amount == null) {
      setError(PRICE_ERROR);
      return;
    }
    void submit('change_price', amount);
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="rounded-xl border border-(--tone-rose-line) bg-(--tone-rose-soft) px-3.5 py-2.5 text-sm text-(--tone-rose-text)">
          {error}
        </p>
      ) : null}
      <Button
        ref={acceptRef}
        type="button"
        disabled={pending}
        onClick={() => void submit('accept')}
        className={cn(
          'h-12 w-full rounded-full bg-(--tone-lite-solid) text-[15px] font-semibold text-white hover:bg-(--tone-lite-solid)/90',
          intent === 'accept' && HIGHLIGHT,
        )}
      >
        {acceptLabel(lead)}
      </Button>
      {firm ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            changePrice();
          }}
        >
          <div
            ref={changeRef}
            className={cn('space-y-2 rounded-2xl bg-muted/60 p-3.5', intent === 'change' && HIGHLIGHT)}
          >
            <p className="text-sm font-medium">Change price</p>
            <div className="flex h-11 min-w-0 items-center rounded-xl border border-input bg-card">
              <span className="pl-3 text-sm text-muted-foreground">£</span>
              <input
                ref={priceRef}
                inputMode="decimal"
                autoComplete="off"
                aria-label="Price"
                disabled={pending}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none"
              />
            </div>
            <Button
              type="submit"
              disabled={pending}
              className="h-11 w-full rounded-full border border-(--tone-lite-solid) bg-transparent font-semibold text-(--tone-lite-text) hover:bg-(--tone-lite-soft)"
            >
              Accept at this price
            </Button>
          </div>
        </form>
      ) : null}
      <p className="text-sm text-muted-foreground text-balance">
        {lead.firstName} gets a friendly text from you either way. Then message them from your own mobile to fix a time.
      </p>
      <Button
        ref={declineRef}
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => void submit('decline')}
        className={cn(
          'h-11 w-full rounded-full border-(--tone-rose-solid) text-(--tone-rose-text) hover:bg-(--tone-rose-soft) hover:text-(--tone-rose-text)',
          intent === 'decline' && HIGHLIGHT,
        )}
      >
        Decline
      </Button>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox
          checked={tell}
          disabled={pending}
          onCheckedChange={(value) => setTell(value === true)}
        />
        Let {lead.firstName} know
      </label>
      <p className="text-sm text-muted-foreground text-balance">
        {lead.firstName} gets a kind text if you leave the box ticked.
      </p>
    </div>
  );
}

export function LeadLinkBody(props: {
  mode: 'open' | 'decided';
  businessName: string;
  lead: LeadLinkLead;
  leadId: string;
  token: string | null;
  intent: 'accept' | 'change' | 'decline' | null;
}) {
  const [outcome, setOutcome] = useState<LeadLinkView | null>(null);

  if (outcome?.state === 'invalid') {
    return <LeadLinkMessage title="This link doesn't work. It may have been copied wrongly." />;
  }
  if (outcome?.state === 'expired') {
    return (
      <LeadLinkMessage
        title="This link has expired."
        body="Open WorkWise to see and decide on your leads."
      />
    );
  }

  const decided = outcome?.state === 'decided';
  const lead = decided ? outcome.lead : props.lead;

  return (
    <>
      <header className="mb-4 flex items-center gap-3 px-1">
        <BusinessMark name={props.businessName} logoUrl={null} size="lg" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">New booking request</p>
          <h1 className="truncate text-lg font-semibold tracking-tight">{props.businessName}</h1>
        </div>
      </header>
      <main className="space-y-5 rounded-3xl border border-border bg-card p-5 shadow-(--look-card-shadow) sm:p-6">
        {priceOffered(lead) ? (
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="lite">
              {lead.quoteKind === 'firm' ? 'Firm price' : lead.quoteKind === 'guide' ? 'Guide price' : 'Look-and-quote visit'}
            </Tag>
          </div>
        ) : null}
        <LeadSummary lead={lead} />
        {props.mode === 'open' && !decided && props.token ? (
          <DecisionButtons token={props.token} lead={props.lead} intent={props.intent} onDone={setOutcome} />
        ) : (
          <LeadDecidedPanel lead={lead} leadId={props.leadId} />
        )}
      </main>
      <footer className="mt-5 text-center text-xs text-muted-foreground opacity-80">Powered by WorkWise</footer>
    </>
  );
}
