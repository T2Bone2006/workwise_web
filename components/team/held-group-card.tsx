'use client';

import { useState } from 'react';
import { Banknote, FileText } from 'lucide-react';
import { Avatar, Tag } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { londonDateOf } from '@/lib/books/periods';
import { formatGbp } from '@/lib/money/pence';
import type { HeldGroup } from '@/lib/team/hand-in';
import { cn } from '@/lib/utils';
import { formatDayShort } from './format-range';
import type { HandOverTarget } from './hand-over-dialog';

/** What one person is holding, payment by payment, with the two ways to tick it off. */
export function HeldGroupCard({
  group,
  nudgeDays,
  onHandOver,
}: {
  group: HeldGroup;
  nudgeDays: number;
  onHandOver: (target: HandOverTarget) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const overdue = group.oldestAgeDays >= nudgeDays;
  const left = group.workerId === null;

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickedItems = group.items.filter((i) => picked.has(i.paymentId));
  const pickedTotal = Math.round(pickedItems.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
  const latest = (items: typeof group.items) => items.map((i) => londonDateOf(i.receivedAt)).sort().pop() ?? '';

  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card shadow-(--look-card-shadow)" aria-label={`${group.name} is holding ${formatGbp(group.total)}`}>
      <header className="flex flex-wrap items-center gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
        <Avatar name={group.name} tone="rounds" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-[15px] font-semibold">{group.name}</h2>
            {left ? <Tag tone="slate">Left the team</Tag> : null}
            {overdue ? <Tag tone="amber">{group.oldestAgeDays} days</Tag> : null}
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            Holding <span className="font-semibold text-(--tone-rose-text)">{formatGbp(group.total)}</span> · oldest{' '}
            {group.oldestAgeDays === 0 ? 'today' : `${group.oldestAgeDays} ${group.oldestAgeDays === 1 ? 'day' : 'days'}`}
          </p>
        </div>
      </header>

      <ul className="divide-y divide-border border-y border-border">
        {group.items.map((item) => {
          const on = picked.has(item.paymentId);
          const MethodIcon = item.method === 'cheque' ? FileText : Banknote;
          return (
            <li key={item.paymentId}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-4 py-3 sm:px-5',
                  on ? 'bg-(--tone-sky-soft)' : rowHover,
                )}
              >
                <Checkbox checked={on} onCheckedChange={() => toggle(item.paymentId)} aria-label={`Tick ${item.customerName}, ${formatGbp(item.amount)}`} className="size-5" />
                <MethodIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.customerName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.method === 'cheque' ? 'Cheque' : 'Cash'} · {formatDayShort(londonDateOf(item.receivedAt))}
                    {item.visitTitle ? ` · ${item.visitTitle}` : ''}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatGbp(item.amount, { always2dp: item.amount % 1 !== 0 })}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <footer className="flex flex-col gap-2 p-4 sm:p-5">
        <Button
          type="button"
          className="w-full"
          onClick={() =>
            onHandOver({ mode: 'all', name: group.name, workerId: group.workerId, paymentIds: group.items.map((i) => i.paymentId), total: group.total, latestTaken: latest(group.items) })
          }
        >
          {group.name} handed over {formatGbp(group.total)}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={picked.size === 0}
          onClick={() =>
            onHandOver({ mode: 'selected', name: group.name, workerId: group.workerId, paymentIds: pickedItems.map((i) => i.paymentId), total: pickedTotal, latestTaken: latest(pickedItems) })
          }
        >
          Tick selected as handed over{picked.size > 0 ? ` (${formatGbp(pickedTotal)})` : ''}
        </Button>
      </footer>
    </article>
  );
}
