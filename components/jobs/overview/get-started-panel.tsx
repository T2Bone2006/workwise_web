'use client';

import Link from 'next/link';
import { Briefcase, Check, Upload, Users, X, type LucideIcon } from 'lucide-react';
import { IconChip, type Tone } from '@/components/look';
import { useStoredFlag } from '@/components/rounds/use-stored-flag';
import { Button } from '@/components/ui/button';
import type { GetStartedState } from '@/lib/data/get-started-core';
import { cn } from '@/lib/utils';

type Step = {
  key: 'team' | 'customers' | 'jobs';
  icon: LucideIcon;
  tone: Tone;
  title: string;
  done: boolean;
  doneLabel: string;
  body: string;
  action: { label: string; href: string };
  secondary?: { label: string; href: string };
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A new Pro business's first screen: three steps, each done or next. Shown by the dashboard only to the admin of a
 * Stripe-billed Pro business that still has something left to do. Hiding it is remembered in this browser only.
 */
export function GetStartedPanel({ state }: { state: GetStartedState }) {
  const [show, setShow] = useStoredFlag('workwise-get-started', true);
  if (!state.show || !show) return null;

  const { team, customers, jobs } = state.steps;
  const wantsMore = state.expectedWorkers != null && team.count < state.expectedWorkers;

  const steps: Step[] = [
    {
      key: 'team',
      icon: Users,
      tone: 'sky',
      title: 'Add your team',
      done: team.done,
      doneLabel: `${plural(team.count, 'worker', 'workers')} on your team`,
      body: wantsMore
        ? `You said ${state.expectedWorkers} workers. Add them all in one go.`
        : 'Paste them from a spreadsheet, or add them one at a time.',
      action: { label: 'Add your team', href: '/workers/add-several' },
      secondary: { label: 'Add one worker', href: '/workers/new' },
    },
    {
      key: 'customers',
      icon: Upload,
      tone: 'emerald',
      title: 'Bring in your customers and jobs',
      done: customers.done,
      doneLabel: plural(customers.count, 'customer', 'customers'),
      body: "Upload a spreadsheet and we'll do the typing.",
      action: { label: 'Import', href: '/import' },
      secondary: { label: 'Add one customer', href: '/customers/new' },
    },
    {
      key: 'jobs',
      icon: Briefcase,
      tone: 'indigo',
      title: 'Create your first job',
      done: jobs.done,
      doneLabel: plural(jobs.count, 'job', 'jobs'),
      body: 'Pick a customer, say what’s needed, and send it to a worker.',
      action: { label: 'New job', href: '/jobs/new' },
    },
  ];
  const next = steps.find((s) => !s.done)?.key;

  return (
    <section
      aria-labelledby="get-started-heading"
      className="relative rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5"
    >
      <button
        type="button"
        onClick={() => setShow(false)}
        className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Hide this"
        title="Hide this"
      >
        <X className="size-4" aria-hidden />
      </button>

      <div className="pr-8">
        <h2 id="get-started-heading" className="text-[17px] font-semibold tracking-tight">
          Let&apos;s get your team set up
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Three quick steps and you&apos;re running.</p>
      </div>

      <ol className="mt-4 grid gap-3 lg:grid-cols-3">
        {steps.map((step) => {
          const isNext = step.key === next;
          return (
            <li
              key={step.key}
              className={cn(
                'flex flex-col rounded-xl border p-4',
                step.done
                  ? 'border-border bg-muted/40'
                  : isNext
                    ? 'border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20'
                    : 'border-border bg-card',
              )}
            >
              <div className="flex items-center gap-3">
                <IconChip icon={step.done ? Check : step.icon} tone={step.done ? 'emerald' : step.tone} />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold leading-snug">{step.title}</h3>
                  {step.done ? <p className="text-xs font-medium text-muted-foreground">{step.doneLabel}</p> : null}
                </div>
              </div>
              {step.done ? null : (
                <>
                  <p className="mt-3 text-[13px] leading-snug text-muted-foreground">{step.body}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Button asChild size="sm" variant={isNext ? 'gradient' : 'outline'} className="w-full sm:w-auto">
                      <Link href={step.action.href}>{step.action.label}</Link>
                    </Button>
                    {step.secondary ? (
                      <Link
                        href={step.secondary.href}
                        className="text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {step.secondary.label}
                      </Link>
                    ) : null}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
