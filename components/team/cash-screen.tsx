'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CheckCircle2, Clock, History } from 'lucide-react';
import { Avatar, EmptyState, LookCard, StatTile, floatingMessage } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import { Button } from '@/components/ui/button';
import { undoHandOverAction } from '@/lib/actions/team-cash';
import type { CashPageData } from '@/lib/data/team-cash-page';
import { formatGbp } from '@/lib/money/pence';
import { londonDateOf } from '@/lib/books/periods';
import { diffDays } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';
import { formatDayShort } from './format-range';
import { HandOverDialog, type HandOverTarget } from './hand-over-dialog';
import { HeldGroupCard } from './held-group-card';
import { TeamHeader } from './team-header';

const UNDO_DAYS = 14;

/** Cash to hand in: what each person is holding for you, and the quick way to tick it off when it's handed over. */
export function CashScreen({ data }: { data: CashPageData }) {
  const router = useRouter();
  const [target, setTarget] = useState<HandOverTarget | null>(null);
  const total = Math.round(data.groups.reduce((sum, g) => sum + g.total, 0) * 100) / 100;
  const oldest = data.groups.reduce((max, g) => Math.max(max, g.oldestAgeDays), 0);

  const undo = async (paymentId: string) => {
    const result = await undoHandOverAction({ paymentId });
    floatingMessage(result.ok ? { title: 'Put back on the hand-in list', tone: 'success' } : { title: result.error, tone: 'error' });
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <TeamHeader
        tab="cash"
        subtitle="Cash and cheques your team has taken. The customer has paid; it counts in your money once you tick it."
      />

      {data.groups.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nothing to hand in" body="Your team has handed over everything." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="With your team"
              value={formatGbp(total)}
              tone="rose"
              icon={Banknote}
              sub={`${data.groups.length} ${data.groups.length === 1 ? 'person' : 'people'}`}
            />
            <StatTile
              label="Oldest cash"
              value={oldest === 0 ? 'Today' : `${oldest} ${oldest === 1 ? 'day' : 'days'}`}
              tone={oldest >= data.nudgeDays ? 'amber' : 'slate'}
              icon={Clock}
              sub={oldest >= data.nudgeDays ? 'Worth asking for' : 'Nothing overdue'}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.groups.map((group) => (
              <HeldGroupCard key={group.workerId ?? group.name} group={group} nudgeDays={data.nudgeDays} onHandOver={setTarget} />
            ))}
          </div>
        </div>
      )}

      {data.recent.length > 0 ? (
        <LookCard title="Recently handed in" icon={History} tone="emerald">
          <ul className="-mx-4 divide-y divide-border sm:-mx-5">
            {data.recent.map((r) => {
              const day = londonDateOf(r.handedOverAt);
              const canUndo = diffDays(day, data.today) <= UNDO_DAYS;
              return (
                <li key={r.paymentId} className={cn('flex items-center gap-3 px-4 py-3 first:pt-0 last:pb-0 sm:px-5', rowHover)}>
                  <Avatar name={r.collectorName} tone="slate" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {r.collectorName} <span className="font-normal text-muted-foreground">· {r.customerName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Handed over {formatDayShort(day)}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-(--tone-emerald-text)">{formatGbp(r.amount)}</p>
                  {canUndo ? (
                    <Button type="button" variant="ghost" size="xs" onClick={() => undo(r.paymentId)}>
                      Undo
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </LookCard>
      ) : null}

      {target ? <HandOverDialog target={target} today={data.today} onClose={() => setTarget(null)} /> : null}
    </div>
  );
}
