'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Check, Maximize2, RotateCcw, Sparkles, X } from 'lucide-react';
import { toneClasses, type Tone } from '@/components/look';
import { pageContext, useAsk } from '@/components/assistant/ask-provider';
import { useMediaQuery, useStoredFlag } from '@/components/rounds/use-stored-flag';
import { Conversation, DoneTodayList, quickSuggestions } from '@/components/assistant/conversation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const headButton =
  'inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/**
 * Quick ask, docked beside the page rather than over it: nothing is dimmed, so
 * you can see what you're asking about and watch a change land when you tap
 * Do it. It follows you as you move between pages. Starts fresh each time it
 * opens from the Ask button at the bottom right of every page. On phone-width
 * screens it takes the whole screen.
 */
export function AskDock() {
  const ctx = useAsk();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = useMemo(() => pageContext(pathname, new URLSearchParams(params.toString())), [pathname, params]);
  // The map fills its page, so keep the button clear of its side panel (and of the pull-up sheet on a phone).
  const [mapPanelOpen] = useStoredFlag('workwise-map-panel-open', true);
  const wide = useMediaQuery('(min-width: 1024px)');
  const onMap = pathname === '/map';
  const nudge = onMap ? (wide ? (mapPanelOpen ? { right: 380 + 24 } : undefined) : { bottom: 176 + 16 }) : undefined;
  if (!ctx || pathname.startsWith('/assistant')) return null;

  const { quickChat: chat, quickOpen: open, openQuick, closeQuick, hasRounds, hasLite, hasPro, blue } = ctx;
  const tone: Tone = blue ? 'rounds' : 'lite';
  const { state, decide, clear } = chat;
  const doneCount = state.doneToday.filter((a) => a.status === 'done').length;
  // These pages already have the round "+" button at the bottom right: sit above it.
  const aboveAddButton = pathname === '/customers' || (hasPro && pathname === '/jobs');

  if (!open) {
    return (
      <button
        type="button"
        onClick={openQuick}
        aria-label="Ask about this page"
        style={nudge}
        className={cn(
          'fixed right-5 z-40 transition-[right,bottom] duration-300 inline-flex h-12 items-center gap-2 rounded-full pr-5 pl-4 text-sm font-semibold text-white shadow-[0_12px_30px_-10px_rgb(12_102_228/0.65)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.97] sm:right-6',
          aboveAddButton ? 'bottom-24' : 'bottom-5 sm:bottom-6',
          toneClasses(tone).solid,
        )}
      >
        <Sparkles className="size-4" aria-hidden />
        Ask
      </button>
    );
  }

  return (
    <aside
      aria-label="Lily, quick ask"
      className={cn(
        'fixed inset-0 z-50 flex flex-col bg-card text-card-foreground',
        'lg:static lg:inset-auto lg:z-auto lg:w-[440px] lg:shrink-0 lg:border-l lg:border-border',
        'animate-in fade-in-0 slide-in-from-right-4 duration-200',
      )}
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl text-white', toneClasses(tone).solid)} aria-hidden>
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] leading-tight font-semibold">Lily</h2>
          <p className="truncate text-xs text-muted-foreground">{page.label ? `About: ${page.label}` : 'About this page'}</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={headButton} aria-label="Done today" title="Done today">
              <Check className="size-4" aria-hidden />
              {doneCount > 0 ? (
                <span className={cn('flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold', toneClasses('emerald').chip)}>{doneCount}</span>
              ) : null}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[320px] overflow-hidden p-0">
            <p className="border-b border-border px-3 py-2.5 text-sm font-semibold">Done today</p>
            <div className="max-h-[360px] overflow-y-auto">
              <DoneTodayList items={state.doneToday} onUndo={(id) => void decide(id, 'undo')} tone={tone} />
            </div>
          </PopoverContent>
        </Popover>
        {state.turns.length > 0 ? (
          <button type="button" onClick={() => void clear()} className={headButton} aria-label="Start again" title="Start again">
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <Link href="/assistant" className={headButton} aria-label="Open Lily full size" title="Open Lily full size">
          <Maximize2 className="size-3.5" aria-hidden />
        </Link>
        <button type="button" onClick={closeQuick} className={headButton} aria-label="Close quick ask" title="Close">
          <X className="size-[18px]" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <Conversation
          chat={chat}
          page={page}
          hasRounds={blue}
          variant="quick"
          autoFocus={open}
          intro={{
            title: 'Ask Lily about this page',
            body: hasPro ? "I can see what you're looking at, so you can just say \"this job\" or \"this worker\"." : "I can see what you're looking at, so you can just say \"them\" or \"this day\".",
          }}
          suggestions={[quickSuggestions(page, hasRounds, hasLite, hasPro)]}
        />
      </div>
    </aside>
  );
}
