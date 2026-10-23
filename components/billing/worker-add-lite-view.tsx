'use client';

import { useRef, useState } from 'react';
import { Check, Loader2, MessageCircle } from 'lucide-react';
import { Tag } from '@/components/look/tag';
import { cn } from '@/lib/utils';
import { startWorkerLiteCheckoutAction } from '@/lib/actions/billing';
import { formatPence, PLANS, type BillingInterval } from '@/lib/billing/plans';
import { workerLitePence } from '@/lib/billing/worker-price';
import { PhoneScene, WebsiteScene } from './add-lite-scenes';
import { WebsiteOfferLine } from './website-offer-line';

const INTERVALS: { value: BillingInterval; label: string }[] = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
];

/** The Add Lite page for a self-employed worker: what Lite is, the worker price, and one button to Stripe. */
export function WorkerAddLiteView({ employerName }: { employerName: string }) {
  const [interval, setIntervalValue] = useState<BillingInterval>('month');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // A new nonce for each click; the same click retried by the browser keeps the same one.
  const nonce = useRef<string>(crypto.randomUUID());

  const per = interval === 'year' ? 'year' : 'month';
  const full = PLANS.lite.pence[interval];
  const worker = workerLitePence(interval);

  const add = async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setPaying(true);
    try {
      const result = await startWorkerLiteCheckoutAction({ interval, nonce: nonce.current });
      if (!result.ok) {
        setError(result.error);
        nonce.current = crypto.randomUUID();
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError("Couldn't start the payment. Nothing was charged. Please try again.");
      nonce.current = crypto.randomUUID();
    } finally {
      busy.current = false;
      setPaying(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <section className="overflow-hidden rounded-3xl border border-(--tone-lite-line) bg-(--tone-lite-soft) p-5 sm:p-7">
        <Tag tone="lite">
          <MessageCircle className="size-3" aria-hidden />
          Lite
        </Tag>
        <h1 className="mt-3 max-w-[22ch] text-[1.9rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.25rem]">
          Win your own work too
        </h1>
        <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-muted-foreground">
          You work with {employerName} through WorkWise. Lite is for the jobs that are yours: Lily answers customers on
          your own website, quotes in your prices, and tells you the ones that book.
        </p>
        <ol className="mt-7 grid gap-3 sm:grid-cols-2 sm:gap-5">
          {[
            { title: 'It answers on your website', text: 'Day and night, pricing jobs the way you do.', Scene: WebsiteScene },
            { title: 'You accept in one tap', text: 'Customers can book in. You say yes from your phone.', Scene: PhoneScene },
          ].map((stage, i) => (
            <li
              key={stage.title}
              className="flex flex-col rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-(--look-card-shadow)"
            >
              <div className="flex min-h-[200px] flex-1 items-center justify-center rounded-xl bg-muted/40 p-3">
                <div className="w-full max-w-[300px]">
                  <stage.Scene />
                </div>
              </div>
              <div className="flex items-start gap-2 px-1 pt-3 pb-1">
                <span
                  className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-(--look-lite-pill) text-[11px] font-semibold text-white"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div>
                  <h2 className="text-[14px] leading-snug font-semibold">{stage.title}</h2>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{stage.text}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 rounded-3xl border border-border bg-card p-5 text-card-foreground shadow-(--look-card-shadow) sm:p-7 lg:grid-cols-2 lg:gap-10">
        <div>
          <div role="group" aria-label="How often you pay" className="inline-flex rounded-full bg-look-segment p-1 text-sm font-medium">
            {INTERVALS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={interval === option.value}
                disabled={paying}
                onClick={() => setIntervalValue(option.value)}
                className={cn(
                  'rounded-full px-4 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  interval === option.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-5 text-sm font-medium text-muted-foreground">Your price</p>
          <p className="mt-1 flex items-baseline gap-3">
            <span className="text-[2.75rem] leading-none font-semibold tracking-tight tabular-nums">{formatPence(worker)}</span>
            <span className="text-sm text-muted-foreground">a {per}</span>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <s className="tabular-nums">{formatPence(full)}</s>
            <Tag tone="emerald">20% off</Tag>
          </p>
          <p className="mt-3 max-w-[44ch] text-[13px] leading-snug text-muted-foreground">
            20% off because you work with {employerName}. If you stop working with a Pro account, Lite goes back to{' '}
            {formatPence(full)} a {per} at your next bill.
          </p>
        </div>

        <div className="flex flex-col">
          {error ? (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={paying}
            onClick={() => void add()}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-(--look-lite-pill) text-[15px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-70"
          >
            {paying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Add Lite for {formatPence(worker)} a {per}
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">You&apos;ll pay on Stripe&apos;s secure page.</p>
          <WebsiteOfferLine />
          <ul className="mt-5 flex flex-col gap-2.5 text-[13px] leading-snug text-muted-foreground">
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-(--tone-lite-text)" aria-hidden />
              Next you chat with Lily for a few minutes so she learns how you price.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-(--tone-lite-text)" aria-hidden />
              Your business is separate from {employerName}. They never see your leads or your customers.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-(--tone-lite-text)" aria-hidden />
              Change your mind? Drop Lite any time from Plan &amp; billing. It switches off at your next renewal.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
