'use client';

import { useSyncExternalStore } from 'react';
import { Sparkles } from 'lucide-react';
import { useAsk } from '@/components/assistant/ask-provider';
import { cn } from '@/lib/utils';

const subscribe = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * The Ask bar near the bottom of the sidebar, on every page, with ⌘K: opens
 * the full Your assistant page. (Quick questions about the page you're on use
 * the round Ask button at the bottom right.) In the 72 px rail only the sparkle shows (the row is
 * clipped, never reflowed, like the links).
 */
export function AskSidebarButton({ expanded, onOpened }: { expanded: boolean; onOpened?: () => void }) {
  const ctx = useAsk();
  const mac = useSyncExternalStore(subscribe, isMac, () => true);
  if (!ctx) return null;
  const solid = ctx.blue ? 'bg-(--tone-rounds-solid)' : 'bg-(--tone-lite-solid)';
  return (
    <button
      type="button"
      onClick={() => {
        onOpened?.();
        ctx.ask();
      }}
      aria-label="Ask Lily"
      aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      className={cn(
        'group flex h-11 w-[192px] items-center gap-2.5 rounded-xl border bg-background pr-2 pl-[9px] text-left transition-colors',
        'hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'border-border hover:border-(--tone-rounds-solid)/35',
      )}
    >
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg text-white', solid)} aria-hidden>
        <Sparkles className="size-3.5" />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm text-muted-foreground transition-opacity duration-150 group-hover:text-foreground',
          expanded ? 'opacity-100 delay-100' : 'opacity-0',
        )}
        aria-hidden
      >
        Ask Lily
      </span>
      <kbd
        className={cn(
          'rounded-md border border-border bg-card px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground transition-opacity duration-150',
          expanded ? 'opacity-100 delay-100' : 'opacity-0',
        )}
        aria-hidden
      >
        {mac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
