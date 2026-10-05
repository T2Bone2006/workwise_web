'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone } from 'lucide-react';
import { Avatar, Tag } from '@/components/look';
import { CopyPayLinkButton } from '@/components/payments/copy-pay-link-button';
import { formatDayShort } from '@/components/payments/method-style';
import { OwedAgeTag } from '@/components/payments/owed-age';
import { RecordPaymentDialog } from '@/components/payments/record-payment-dialog';
import { Button } from '@/components/ui/button';
import type { OwedCustomerRow } from '@/lib/data/payments/owed';
import { formatGbp } from '@/lib/money/pence';

/**
 * Customers who owe money, oldest first: who, how long, what to do about it.
 * Used on the overview (first few) and the Who owes tab (all of them).
 * Every action is the one Payments always had: call, copy the pay link, Mark as paid.
 */
export function ChaseList({ rows, today }: { rows: OwedCustomerRow[]; today: string }) {
  const router = useRouter();
  const [payingId, setPayingId] = useState<string | null>(null);
  const paying = rows.find((row) => row.customerId === payingId) ?? null;

  return (
    <>
      <ul className="-mx-4 divide-y divide-border sm:-mx-5">
        {rows.map((row) => (
          <li
            key={row.customerId}
            className="group relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors first:pt-0 last:pb-0 hover:bg-muted/50 has-[:focus-visible]:bg-muted/50 sm:flex-nowrap sm:gap-4 sm:px-5"
          >
            <button
              type="button"
              aria-label={`Open ${row.name}`}
              onClick={() => router.push(`/customers/${row.customerId}`)}
              className="absolute inset-x-0 inset-y-0 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
            <span className="pointer-events-none flex min-w-0 flex-1 basis-36 items-center gap-3">
              <Avatar name={row.name} tone={row.failedDirectDebits > 0 ? 'rose' : 'slate'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium tracking-tight">{row.name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
                  <span>
                    {row.unpaidVisitCount === 1 ? '1 visit' : `${row.unpaidVisitCount} visits`}
                    {row.oldestUnpaidDate ? ` since ${formatDayShort(row.oldestUnpaidDate)}` : ''}
                  </span>
                  {row.collectingAmount > 0 ? (
                    <Tag tone="rounds">Collecting {formatGbp(row.collectingAmount)}</Tag>
                  ) : null}
                  {row.hasDirectDebit && row.failedDirectDebits === 0 ? <Tag tone="slate">Direct Debit</Tag> : null}
                  {row.failedDirectDebits > 0 ? <Tag tone="rose">Direct Debit failed</Tag> : null}
                  {row.chaseStage === 2 ? <Tag tone="amber">Chase</Tag> : null}
                  {row.chaseStage === 1 ? <Tag tone="slate">Reminded</Tag> : null}
                </span>
              </span>
            </span>
            <span className="pointer-events-none flex items-center gap-3 sm:w-40 sm:justify-end">
              <OwedAgeTag oldest={row.oldestUnpaidDate} today={today} />
              <span className="min-w-14 text-right text-base font-semibold text-(--tone-rose-solid) tabular-nums">
                {formatGbp(row.owedAmount)}
              </span>
            </span>
            <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0">
              {row.phone ? (
                <Button asChild variant="outline" size="icon" className="size-9 sm:size-8">
                  <a href={`tel:${row.phone}`} aria-label={`Call ${row.name}`} title="Call">
                    <Phone className="size-4" />
                  </a>
                </Button>
              ) : null}
              <CopyPayLinkButton customerId={row.customerId} available iconOnly />
              <Button
                size="sm"
                className="bg-(--tone-emerald-solid) text-white hover:bg-(--tone-emerald-solid)/90"
                onClick={() => setPayingId(row.customerId)}
              >
                Mark as paid
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {paying ? (
        <RecordPaymentDialog
          key={paying.customerId}
          customerId={paying.customerId}
          defaultAmount={paying.owedAmount}
          unpaidVisits={[]}
          open
          onOpenChange={(open) => {
            if (!open) setPayingId(null);
          }}
        />
      ) : null}
    </>
  );
}
