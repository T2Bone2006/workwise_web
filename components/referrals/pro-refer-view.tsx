'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Copy, Mail, MessageCircle, MessageSquare, PoundSterling, UserPlus, Users } from 'lucide-react';
import { Avatar } from '@/components/look/avatar';
import { EmptyState } from '@/components/look/empty-state';
import { StatTile } from '@/components/look/stat-tile';
import { Tag } from '@/components/look/tag';
import { formatPoundsLong } from '@/lib/billing/pro-plans';
import type { ProReferralData } from '@/lib/data/referral-page';
import { formatDayMonth } from './referral-utils';
import { creditEarnedPence, proHowItWorks, proReferralStatus, proShareMessage } from './pro-referral-copy';

function displayLink(link: string): string {
  return link.replace(/^https?:\/\//, '');
}

const GREEN_BUTTON =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-(--look-green-pill) px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--look-green-pill) focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none';
const SHARE_BUTTON =
  'inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-(--look-green-pill) focus-visible:outline-none sm:flex-none';

/** Refer page for a Stripe-billed Pro business. Same shape as the Rounds page, but it promises the friend nothing. */
export function ProReferView({ link, code, referrals, myMonthlyPence }: ProReferralData) {
  const boxRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const joined = referrals.length;
  const waiting = referrals.filter((row) => row.status === 'waiting' || row.status === 'rewarding').length;
  const credit = creditEarnedPence(referrals);
  const message = proShareMessage(link);
  const encoded = encodeURIComponent(message);
  const steps = proHowItWorks(myMonthlyPence);

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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <section className="rounded-3xl border border-(--tone-emerald-line) bg-(--tone-emerald-soft) p-5 sm:p-7">
        <h1 className="max-w-[22ch] text-[1.9rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.25rem]">
          Refer a business
        </h1>
        <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-muted-foreground">
          Know a trade business that needs to run its team in one place? Share your link.
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
                className="h-10 min-w-0 shrink-0 rounded-xl border sm:flex-1 border-border bg-background px-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-(--look-green-pill) focus-visible:outline-none"
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
                href={`mailto:?subject=${encodeURIComponent('WorkWise Pro for your team')}&body=${encoded}`}
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
            <p className="text-xs font-medium text-muted-foreground">What they get sent</p>
            <p className="mt-2.5 max-w-[34ch] self-end rounded-2xl rounded-br-md bg-(--look-green-pill) px-3.5 py-2.5 text-[13.5px] leading-snug text-white">
              {message}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">You can change the words before you send it.</p>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 min-[560px]:grid-cols-3">
            <StatTile label="Joined" value={String(joined)} tone="slate" icon={Users} sub="used your link" />
            <StatTile label="Waiting" value={String(waiting)} tone="amber" icon={Clock} sub="for their payments" />
            <div className="col-span-2 min-[560px]:col-span-1">
              <StatTile
                label="Credit earned"
                value={formatPoundsLong(credit)}
                tone="emerald"
                icon={PoundSterling}
                sub="added to your account"
              />
            </div>
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
                <EmptyState icon={UserPlus} title="Nobody yet." body="Your first referral will show here." />
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {referrals.map((row) => {
                  const status = proReferralStatus(row);
                  return (
                    <li
                      key={row.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={row.businessName} tone={status.tone} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.businessName}</p>
                          <p className="text-xs text-muted-foreground">Joined {formatDayMonth(row.createdAt)}</p>
                        </div>
                      </div>
                      <div className="pl-12 sm:pl-0">
                        <Tag tone={status.tone}>{status.label}</Tag>
                      </div>
                    </li>
                  );
                })}
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
                  className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-(--look-green-pill) text-[11px] font-semibold text-white"
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
