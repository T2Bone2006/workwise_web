'use client';

import { CalendarPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { Avatar, Tag } from '@/components/look';
import { toneClasses } from '@/components/look/tones';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { owedFigure, type TeamPayStatement } from '@/lib/data/team-pay-page-core';
import { formatGbp } from '@/lib/money/pence';
import type { DayRow, PaymentRow } from '@/lib/team/pay';
import { cn } from '@/lib/utils';
import { formatDayShort } from './format-range';

/** One person's days and payments for the period, with the controls to fix a day or void a payment. */
export function PersonStatementSheet({
  statement,
  label,
  onClose,
  onPay,
  onAddDay,
  onEditDay,
  onRemoveDay,
  onVoid,
}: {
  statement: TeamPayStatement;
  label: string;
  onClose: () => void;
  onPay: () => void;
  onAddDay: () => void;
  onEditDay: (day: DayRow) => void;
  onRemoveDay: (day: DayRow) => void;
  onVoid: (payment: PaymentRow) => void;
}) {
  const { person, days, payments } = statement;
  const owed = owedFigure(person);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
        <SheetHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3 pr-8">
            <Avatar name={person.name} tone={person.kind === 'lead' && person.active ? 'rounds' : 'slate'} />
            <div className="min-w-0">
              <SheetTitle className="truncate">{person.name}</SheetTitle>
              <SheetDescription>{label}</SheetDescription>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Earned</dt>
              <dd className="font-semibold tabular-nums">{formatGbp(person.earnedPence / 100)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paid</dt>
              <dd className="font-semibold tabular-nums">{formatGbp(person.paidPence / 100)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{owed.kind === 'ahead' ? 'Ahead' : 'Owed'}</dt>
              <dd className={cn('font-semibold tabular-nums', toneClasses(owed.tone).text)}>
                {owed.kind === 'paid_up' ? 'Paid up' : formatGbp(owed.pence / 100)}
              </dd>
            </div>
          </dl>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          <section aria-labelledby="days-heading">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="days-heading" className="text-[15px] font-semibold">
                Days worked
              </h3>
              <Button type="button" variant="outline" size="sm" onClick={onAddDay}>
                <CalendarPlus /> Add a day
              </Button>
            </div>
            {days.length === 0 ? (
              <p className="rounded-xl bg-muted/60 px-3 py-3 text-sm text-muted-foreground">No days worked in this period.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {days.map((day) => (
                  <li key={day.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                        {formatDayShort(day.date)}
                        <Tag tone={day.role === 'lead' ? 'rounds' : 'slate'}>{day.role === 'lead' ? 'Lead' : 'Helper'}</Tag>
                        {day.source === 'manual' ? <Tag tone="violet">Added by you</Tag> : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {day.withName ? `with ${day.withName}` : null}
                        {day.withName && day.note ? ' · ' : null}
                        {day.note}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatGbp(day.ratePence / 100)}</p>
                    <div className="flex shrink-0">
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEditDay(day)} aria-label={`Change ${formatDayShort(day.date)}`}>
                        <Pencil />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => onRemoveDay(day)} aria-label={`Remove ${formatDayShort(day.date)}`}>
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="payments-heading">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="payments-heading" className="text-[15px] font-semibold">
                Payments
              </h3>
              <Button type="button" size="sm" onClick={onPay}>
                <Plus /> Record payment
              </Button>
            </div>
            {payments.length === 0 ? (
              <p className="rounded-xl bg-muted/60 px-3 py-3 text-sm text-muted-foreground">No payments recorded in this period.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {payments.map((payment) => (
                  <li key={payment.id} className={cn('flex items-center gap-3 px-3 py-2.5', payment.voided && 'opacity-60')}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                        {formatDayShort(payment.paidOn)}
                        {payment.voided ? <Tag tone="slate">Voided</Tag> : null}
                      </p>
                      {payment.note ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{payment.note}</p> : null}
                    </div>
                    <p className={cn('text-sm font-semibold tabular-nums', payment.voided ? 'line-through' : toneClasses('emerald').text)}>
                      {formatGbp(payment.amountPence / 100)}
                    </p>
                    {payment.voided ? null : (
                      <Button type="button" variant="ghost" size="xs" onClick={() => onVoid(payment)}>
                        Void
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
