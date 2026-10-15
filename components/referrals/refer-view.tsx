'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Copy, Gift, Mail, MessageCircle, MessageSquare, PoundSterling, UserPlus, Users } from 'lucide-react';
import { Avatar } from '@/components/look/avatar';
import { EmptyState } from '@/components/look/empty-state';
import { StatTile } from '@/components/look/stat-tile';
import { Tag } from '@/components/look/tag';
import { formatPence } from '@/lib/billing/plans';
import type { ReferralRow } from '@/lib/billing/referrals';
import type { ReferralData } from '@/lib/data/referral-page';
import { cn } from '@/lib/utils';
import { formatDayMonth, friendOfferLine, referralTotals } from './referral-utils';

function displayLink(link: string): string {
  return link.replace(/^https?:\/\//, '');
}

/** The message the share buttons send. A referred friend's first month is free either way. */
function shareMessage(link: string): string {
  return `I use WorkWise to run my round. Sign up with my link and your first month's free: ${link}`;
}

function statusTag(row: ReferralRow) {
  if (row.status === 'rewarded') {
    const when = formatDayMonth(row.rewardedAt);
    return <Tag tone="emerald">{when ? `Free month added ${when}` : 'Free month added'}</Tag>;
  }
  if (row.status === 'void') return <Tag tone="slate">Didn&apos;t qualify</Tag>;
  return <Tag tone="amber">Waiting for their first full month</Tag>;
}

const GREEN_BUTTON =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-(--look-green-pill) px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--look-green-pill) focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none';
const SHARE_BUTTON =
  'inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-(--look-green-pill) focus-visible:outline-none sm:flex-none';

export function ReferView({ link, code, referrals, foundingActive, myMonthlyPence }: ReferralData) {
  const boxRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const { joined, earned, creditedPence, waiting } = referralTotals(referrals);
  const message = shareMessage(link);
  const encoded = encodeURIComponent(message);

  const markCopied = (what: 'link' | 'code') => {
    setCopied(what);
    timers.current.push(window.setTimeout(() => setCopied(null), 2000));
  };

  const copy = async (text: string, what: 'link' | 'code') => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard');
      await navigator.clipboard.writeText(text);
      markCopied(what);
    } catch {
      const box = boxRef.current;
      if (what !== 'link' || !box) return;
      box.focus();
      box.select();
    }
  };

  const steps = [
    { title: 'You send your link', text: 'Text it, WhatsApp it or email it. Or give them your code.' },
    { title: 'They sign up', text: friendOfferLine(foundingActive) },
    {
      title: 'They pay their first full month',
      text: "That's the bill that counts, so it can take a couple of months. Until then you'll see them as waiting.",
    },
    {
      title: 'You get a month off',
      text: `${formatPence(myMonthlyPence)} comes off your next bill. There's no limit on how many you can earn.`,
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <section className="rounded-3xl border border-(--tone-emerald-line) bg-(--tone-emerald-soft) p-5 sm:p-7">
        <Tag tone="emerald">
          <Gift className="size-3" aria-hidden />
          Referrals
        </Tag>
        <h1 className="mt-3 max-w-[22ch] text-[1.9rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.25rem]">
          Give a month, get a month
        </h1>
        <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-muted-foreground">
          Send another trader your link. When they&apos;ve paid for their first full month, {formatPence(myMonthlyPence)}{' '}
          comes off your next bill.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-(--look-card-shadow) sm:p-5">
            <label htmlFor="referral-link" className="text-sm font-medium">
              Your link
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="referral-link"
                ref={boxRef}
                readOnly
                value={displayLink(link)}
                onFocus={(event) => event.currentTarget.select()}
                className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-(--look-green-pill) focus-visible:outline-none"
              />
              <button type="button" onClick={() => void copy(link, 'link')} className={GREEN_BUTTON} aria-live="polite">
                {copied === 'link' ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`https://wa.me/?text=${encoded}`}
                target="_blank"
                rel="noopener noreferrer"
                className={SHARE_BUTTON}
              >
                <MessageCircle className="size-4 text-(--tone-emerald-text)" aria-hidden />
                WhatsApp
              </a>
              <a href={`sms:?&body=${encoded}`} className={SHARE_BUTTON}>
                <MessageSquare className="size-4 text-(--tone-emerald-text)" aria-hidden />
                Text
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent('WorkWise for your round')}&body=${encoded}`}
                className={SHARE_BUTTON}
              >
                <Mail className="size-4 text-(--tone-emerald-text)" aria-hidden />
                Email
              </a>
            </div>

            <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
              Or give them your code
              <button
                type="button"
                onClick={() => void copy(code, 'code')}
                aria-label={`Copy your code ${code}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[13px] font-semibold tracking-wider text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-(--look-green-pill) focus-visible:outline-none"
              >
                {code}
                {copied === 'code' ? (
                  <Check className="size-3.5 text-(--tone-emerald-text)" aria-hidden />
                ) : (
                  <Copy className="size-3 text-muted-foreground" aria-hidden />
                )}
              </button>
            </p>
          </div>

          <div className="flex flex-col justify-center rounded-2xl bg-muted/50 p-4 sm:p-5" aria-hidden>
            <p className="text-xs font-medium text-muted-foreground">What your friend gets sent</p>
            <p className="mt-2.5 max-w-[34ch] self-end rounded-2xl rounded-br-md bg-(--look-green-pill) px-3.5 py-2.5 text-[13.5px] leading-snug text-white">
              {message}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">You can change the words before you send it.</p>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Joined" value={String(joined)} tone="slate" icon={Users} sub="used your link" />
            <StatTile label="Waiting" value={String(waiting)} tone="amber" icon={Clock} sub="for a full month" />
            <StatTile
              label="Months earned"
              value={String(earned)}
              tone="emerald"
              icon={PoundSterling}
              sub={`${formatPence(creditedPence)} credited`}
            />
          </div>

          <section
            aria-labelledby="who-joined"
            className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-(--look-card-shadow) sm:p-5"
          >
            <h2 id="who-joined" className="text-[15px] font-semibold">
              Who&apos;s joined
            </h2>
            {referrals.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  icon={UserPlus}
                  title="Nobody's used your link yet"
                  body="Window cleaners know window cleaners: send it to one."
                />
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {referrals.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        name={row.businessName}
                        tone={row.status === 'rewarded' ? 'emerald' : row.status === 'void' ? 'slate' : 'amber'}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{row.businessName}</p>
                        <p className="text-xs text-muted-foreground">Joined {formatDayMonth(row.createdAt)}</p>
                      </div>
                    </div>
                    <div className="pl-12 sm:pl-0">{statusTag(row)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section
          aria-labelledby="how-it-works"
          className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-(--look-card-shadow) sm:p-5"
        >
          <h2 id="how-it-works" className="text-[15px] font-semibold">
            How it works
          </h2>
          <ol className="mt-4 flex flex-col">
            {steps.map((step, i) => (
              <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
                {i < steps.length - 1 ? (
                  <span className="absolute top-6 bottom-0 left-[11px] w-px bg-(--tone-emerald-line)" aria-hidden />
                ) : null}
                <span
                  className={cn(
                    'relative flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white',
                    'bg-(--look-green-pill)'
                  )}
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-sm leading-6 font-semibold">{step.title}</h3>
                  <p className="text-[13px] leading-snug text-muted-foreground">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
