'use client';

import { useState } from 'react';
import { Banknote, CheckCircle2, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { LedgerPayment } from '@/lib/data/payments/ledger';
import type { VisitRow } from '@/lib/data/rounds/visits';
import { formatGbp } from '@/lib/money/pence';
import type { PaymentMethod } from '@/lib/payments/money-core';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  other: 'Other',
};

function formatWhen(isoOrYmd: string): string {
  const day = isoOrYmd.slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return isoOrYmd;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

type Activity = {
  id: string;
  at: string;
  title: string;
  detail: string;
  icon: 'visit' | 'payment';
  tone?: 'ok' | 'warn' | 'danger' | 'muted';
};

const TONE_ICON: Record<NonNullable<Activity['tone']>, string> = {
  ok: 'text-emerald-500',
  warn: 'text-amber-500',
  danger: 'text-rose-500',
  muted: 'text-slate-400',
};

function ActivityRows({ items }: { items: Activity[] }) {
  return (
    <ul className="overflow-hidden rounded-lg border border-border/70">
      {items.map((item, index) => (
        <li
          key={item.id}
          className={`flex gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 ${
            index % 2 === 1 ? 'bg-muted/45' : ''
          }`}
        >
          {item.icon === 'payment' ? (
            <Banknote
              className={`mt-0.5 size-4 shrink-0 ${TONE_ICON[item.tone ?? 'ok']}`}
            />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sky-500" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">{item.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {formatWhen(item.at)}
              {item.detail ? ` · ${item.detail}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CustomerActivity({
  visits,
  payments,
  notes,
}: {
  visits: VisitRow[];
  payments: LedgerPayment[];
  notes: string | null;
}) {
  const [open, setOpen] = useState(false);
  const items: Activity[] = [];

  for (const visit of visits) {
    const at = visit.completed_at ?? visit.scheduled_date;
    if (!at) continue;
    const amount = visit.final_amount ?? visit.quoted_amount;
    const done = visit.status === 'completed';
    items.push({
      id: `visit-${visit.id}`,
      at,
      title: done ? 'Visit done' : visit.status === 'cancelled' ? 'Visit skipped' : 'Visit',
      detail: [visit.job_description, amount != null ? formatGbp(amount) : null]
        .filter(Boolean)
        .join(' · '),
      icon: 'visit',
    });
  }

  for (const payment of payments) {
    const cancelled = payment.status === 'void';
    const refunded = payment.refundedAmount > 0;
    const disputed = Boolean(payment.disputedAt || payment.disputeStatus);
    items.push({
      id: `payment-${payment.id}`,
      at: payment.receivedAt,
      title: cancelled
        ? 'Payment cancelled'
        : disputed
          ? 'Payment disputed'
          : refunded
            ? 'Payment refunded'
            : 'Payment',
      detail: `${formatGbp(payment.amount)} · ${METHOD_LABEL[payment.method]}${
        refunded ? ` · refunded ${formatGbp(payment.refundedAmount)}` : ''
      }`,
      icon: 'payment',
      tone: cancelled ? 'muted' : disputed ? 'danger' : refunded ? 'warn' : 'ok',
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const shown = items.slice(0, 5);
  const hasMore = items.length > shown.length;

  return (
    <Card className="glass-card border-border/80">
      <CardContent className="p-0">
        <div className="px-4 py-3">
          <h2 className="text-lg font-semibold">Activity</h2>
          {items.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {hasMore ? `Showing 5 of ${items.length}` : 'Recent activity'}
            </p>
          ) : null}
        </div>
        {notes ? (
          <div className="flex gap-3 border-t border-border/70 px-4 py-3">
            <StickyNote className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium">Note</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{notes}</p>
            </div>
          </div>
        ) : null}
        {items.length === 0 ? (
          <p className="border-t border-border/70 px-4 py-6 text-sm text-muted-foreground">
            No visits or payments yet.
          </p>
        ) : (
          <>
            <div className="border-t border-border/70">
              <ActivityRows items={shown} />
            </div>
            {hasMore ? (
              <div className="border-t border-border/70 px-4 py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() => setOpen(true)}
                >
                  View all {items.length}
                </Button>
                <Sheet open={open} onOpenChange={setOpen}>
                  <SheetContent
                    side="bottom"
                    className="max-h-[85vh] overflow-y-auto rounded-t-xl"
                  >
                    <SheetHeader>
                      <SheetTitle>Activity ({items.length})</SheetTitle>
                    </SheetHeader>
                    <div className="px-4 pb-6">
                      <ActivityRows items={items} />
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
