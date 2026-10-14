'use client';

import { Avatar, Tag } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import { toneClasses } from '@/components/look/tones';
import { Button } from '@/components/ui/button';
import { owedFigure, type TeamPayRow } from '@/lib/data/team-pay-page-core';
import { formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';

const COLUMNS = 'md:grid-cols-[minmax(0,2fr)_4.5rem_6rem_6rem_minmax(0,1.2fr)_9.5rem]';

function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** One person for the period: days, earned, paid, and what's left in a tone, with the two things you do next. */
function PaySummaryRow({
  row,
  selected,
  onPay,
  onOpen,
}: {
  row: TeamPayRow;
  selected: boolean;
  onPay: (row: TeamPayRow) => void;
  onOpen: (row: TeamPayRow) => void;
}) {
  const owed = owedFigure(row);
  const big =
    owed.kind === 'owed'
      ? formatGbp(owed.pence / 100)
      : owed.kind === 'ahead'
        ? `${formatGbp(owed.pence / 100)} ahead`
        : owed.kind === 'paid_up'
          ? 'Paid up'
          : '£0';
  const caption = owed.kind === 'owed' ? 'still owed' : owed.kind === 'ahead' ? 'paid in advance' : owed.kind === 'nothing' ? 'nothing this period' : null;

  return (
    <li
      className={cn(
        'relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 px-4 py-3',
        COLUMNS,
        selected ? 'bg-(--tone-rounds-soft)' : rowHover,
        !row.active && 'opacity-70',
      )}
      aria-label={`${row.name}: ${big}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={row.name} tone={row.kind === 'lead' && row.active ? 'rounds' : 'slate'} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="block min-w-0 truncate text-left font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
            >
              {row.name}
            </button>
            <Tag tone={row.kind === 'lead' ? 'rounds' : 'slate'}>{row.kind === 'lead' ? 'Lead' : 'Helper'}</Tag>
            {!row.active ? <Tag tone="slate">Removed</Tag> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground tabular-nums md:hidden">
            {plural(row.daysWorked, 'day')} · earned {formatGbp(row.earnedPence / 100)} · paid {formatGbp(row.paidPence / 100)}
          </p>
          <p className="hidden text-xs text-muted-foreground tabular-nums md:block">{formatGbp(row.dayRatePence / 100)} a day</p>
        </div>
      </div>

      <p className="hidden text-right text-sm tabular-nums md:block">{row.daysWorked}</p>
      <p className="hidden text-right text-sm tabular-nums md:block">{formatGbp(row.earnedPence / 100)}</p>
      <p className="hidden text-right text-sm tabular-nums md:block">{formatGbp(row.paidPence / 100)}</p>

      <div className="text-right">
        <p className={cn('font-semibold tabular-nums', toneClasses(owed.tone).figure)}>{big}</p>
        {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
      </div>

      <div className="relative z-10 col-span-2 flex justify-end gap-2 md:col-span-1">
        <Button type="button" size="sm" onClick={() => onPay(row)}>
          Paid…
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onOpen(row)}>
          Days
        </Button>
      </div>
    </li>
  );
}

/** Everyone's pay for the period as one list card, with a column header on wider screens. */
export function PayList({
  rows,
  selectedId,
  onPay,
  onOpen,
}: {
  rows: TeamPayRow[];
  selectedId: string | null;
  onPay: (row: TeamPayRow) => void;
  onOpen: (row: TeamPayRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--look-card-shadow)">
      <div className={cn('hidden gap-4 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid', COLUMNS)}>
        <span>Person</span>
        <span className="text-right">Days</span>
        <span className="text-right">Earned</span>
        <span className="text-right">Paid</span>
        <span className="text-right">Still owed</span>
        <span className="sr-only">Actions</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <PaySummaryRow key={row.personId} row={row} selected={row.personId === selectedId} onPay={onPay} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
}
