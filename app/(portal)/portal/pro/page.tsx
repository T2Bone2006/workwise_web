import { ArrowUpRight, Check } from 'lucide-react';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { cn } from '@/lib/utils';

const SIGNUP_URL = 'https://app.joinworkwise.com/signup/pro';
const LEARN_MORE_URL = 'https://joinworkwise.com/pro';

const OFFERS = [
  {
    pill: 'Your own jobs',
    title: 'Run the work yourself',
    points: [
      'Keep your own jobs in one place',
      'Send each one to the right worker',
      'See the visit and sign it off',
    ],
    block: 'bg-[#0C66E4]',
    glow: 'bg-white/10',
  },
  {
    pill: 'Partner network',
    title: 'Send work to other businesses',
    points: [
      'Connect with other WorkWise businesses',
      'Send a job when your own team is full',
      'Keep watching it from your own dashboard',
    ],
    block: 'bg-[#7B21B3]',
    glow: 'bg-white/10',
  },
] as const;

export default function PortalProPage() {
  return (
    <div className="space-y-5">
      <PageGradientHeader
        title="WorkWise Pro"
        subtitle="Run your own jobs, and send the ones you can't cover to other WorkWise businesses on the Partner network."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {OFFERS.map((offer) => (
          <div
            key={offer.pill}
            className={cn('relative flex flex-col overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6', offer.block)}
          >
            <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full bg-white/15" />
            <div aria-hidden className={cn('pointer-events-none absolute -bottom-16 -left-10 size-40 rounded-full', offer.glow)} />
            <div className="relative flex h-full flex-col">
              <span className="inline-flex w-fit items-center rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                {offer.pill}
              </span>
              <p className="mt-4 text-2xl font-bold tracking-tight">{offer.title}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {offer.points.map((text) => (
                  <li key={text} className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-white text-slate-900">
                      <Check className="size-3" aria-hidden />
                    </span>
                    <span className="text-white/95">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={SIGNUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-amber-300 px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-amber-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Join WorkWise Pro
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
        <a
          href={LEARN_MORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Learn more
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </div>
    </div>
  );
}
