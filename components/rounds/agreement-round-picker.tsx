'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { RoundChip } from '@/components/rounds/round-chip';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { setAgreementRound } from '@/lib/actions/rounds/rounds';
import type { RoundRow } from '@/lib/rounds/rounds';
import { cn } from '@/lib/utils';

export type PickerRound = RoundRow & { leadName: string | null };

/**
 * Which round a house is in, and so who usually does it: a small menu on the house itself. Choosing a round moves the
 * house's upcoming visits to that round's usual lead (visits you gave to someone for a day stay as they are).
 */
export function AgreementRoundPicker({
  agreementId,
  currentRoundId,
  rounds,
  hasTeam,
}: {
  agreementId: string;
  currentRoundId: string | null;
  rounds: PickerRound[];
  /** Show who does each round, only when the business has people to give work to. */
  hasTeam: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const current = rounds.find((r) => r.id === currentRoundId) ?? null;

  const choose = async (roundId: string | null) => {
    if (pending || roundId === currentRoundId) return;
    setPending(true);
    const result = await setAgreementRound(agreementId, roundId);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (!result.roundName) toast.success('Taken out of its round');
    else toast.success(result.leadName ? `In ${result.roundName}. ${result.leadName} does it now.` : `In ${result.roundName}`);
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {current ? (
          <button
            type="button"
            disabled={pending}
            aria-label={`Round: ${current.name}. Change round`}
            className="inline-flex max-w-full items-center gap-1 rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <RoundChip round={current} className="hover:bg-muted" />
            {hasTeam && current.leadName ? <span className="text-xs text-muted-foreground">· {current.leadName}</span> : null}
            <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
          </button>
        ) : (
          <Button type="button" variant="outline" size="xs" disabled={pending} className="h-6 gap-1 rounded-full text-xs font-medium">
            <Plus className="size-3" aria-hidden /> Add to a round
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{hasTeam ? 'Round (who usually does it)' : 'Round'}</DropdownMenuLabel>
        {rounds.map((r) => (
          <DropdownMenuItem key={r.id} onSelect={() => void choose(r.id)}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: r.colour }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {hasTeam ? <span className="text-xs text-muted-foreground">{r.leadName ?? 'You'}</span> : null}
            <Check className={cn('size-4', r.id === currentRoundId ? 'opacity-100' : 'opacity-0')} aria-hidden />
          </DropdownMenuItem>
        ))}
        {current ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void choose(null)}>No round</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
