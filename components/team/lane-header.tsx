'use client';

import { MoreHorizontal, Route } from 'lucide-react';
import { Avatar, Tag } from '@/components/look';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatGbp } from '@/lib/money/pence';
import type { Tone } from '@/components/look/tones';

/** The top of one person's lane: who, how much work and money, and the actions that apply to just their stops. */
export function LaneHeader({
  name,
  isOwner,
  colour,
  stops,
  amount,
  leftovers,
  off,
  onMove,
  onSkip,
  onOptimise,
  busy,
}: {
  name: string;
  isOwner: boolean;
  colour: Tone;
  stops: number;
  amount: number;
  leftovers: number;
  off: boolean;
  onMove: () => void;
  onSkip: () => void;
  onOptimise: () => void;
  busy: boolean;
}) {
  const shown = isOwner ? 'You' : name;
  const possessive = isOwner ? 'your' : `${name}'s`;
  return (
    <header className="flex items-center gap-3 border-b border-border px-3 py-3">
      <Avatar name={shown} tone={colour} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-[15px] font-semibold">{shown}</h3>
          {off ? <Tag tone="amber">Off today</Tag> : null}
          {off && stops > 0 ? <Tag tone="rose">{stops} {stops === 1 ? 'stop' : 'stops'}</Tag> : null}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {stops} {stops === 1 ? 'stop' : 'stops'} · {formatGbp(amount)}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${shown}'s lane`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={leftovers === 0} onSelect={onMove}>
            Move {possessive} remaining ({leftovers})
          </DropdownMenuItem>
          <DropdownMenuItem disabled={leftovers === 0} onSelect={onSkip}>
            Skip {possessive} remaining ({leftovers})
          </DropdownMenuItem>
          <DropdownMenuItem disabled={leftovers < 2 || busy} onSelect={onOptimise}>
            <Route /> Optimise {possessive} route
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
