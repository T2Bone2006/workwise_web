'use client';

import Link from 'next/link';
import { CornerDownRight, Sparkles, X } from 'lucide-react';
import { useAsk } from '@/components/assistant/ask-provider';
import { useStoredFlag } from '@/components/rounds/use-stored-flag';

const STARTERS = ["Who owes me money?", "What's left to do today?", "Show tomorrow's round on a map"];
const PRO_STARTERS = ['What needs me today?', "Who's free tomorrow?", 'Show me the jobs with no worker'];

/**
 * A first hello from Lily at the top of the overview, so a new trader (or Pro office) knows
 * she's there and what to say to her. Dismiss it, or open her, and it stays
 * gone (remembered in this browser; nothing is stored on the account).
 */
export function LilyWelcome({ pro = false }: { pro?: boolean }) {
  const ask = useAsk();
  const [show, setShow] = useStoredFlag('workwise-lily-welcome', true);
  if (!ask || !show) return null;

  return (
    <section
      aria-label="Meet Lily"
      className="relative flex flex-col gap-4 rounded-2xl border border-(--tone-rounds-line) bg-(--tone-rounds-soft) px-5 py-4 sm:flex-row sm:items-center sm:gap-5 sm:px-6"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-(--tone-rounds-solid) text-white" aria-hidden>
        <Sparkles className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold">Hi, I&apos;m Lily.</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {pro ? 'I know your jobs, your team and your customers.' : 'I know your customers, calendar and money.'} Ask me anything, or tell me what to change, and I&apos;ll show you what I&apos;m about to do first.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(pro ? PRO_STARTERS : STARTERS).map((q) => (
            <Link
              key={q}
              href={`/assistant?ask=${encodeURIComponent(q)}`}
              onClick={() => setShow(false)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground/85 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <CornerDownRight className="size-3.5 text-muted-foreground/70" aria-hidden />
              {q}
            </Link>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label="Dismiss"
        className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X className="size-4" />
      </button>
    </section>
  );
}
