'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, Phone } from 'lucide-react';
import { CopyPayLinkButton } from '@/components/payments/copy-pay-link-button';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import { RecordPaymentDialog } from '@/components/payments/record-payment-dialog';
import { MoneyRow, MONEY_ACCENT } from '@/components/payments/money-row';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { OwedCustomerRow } from '@/lib/data/payments/owed';
import { formatGbp } from '@/lib/money/pence';
import { diffDays } from '@/lib/rounds/dates';

function formatSince(ymd: string | null): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function waitingLabel(oldest: string | null, today: string): string {
  if (!oldest) return '—';
  const days = diffDays(oldest, today);
  if (days < 0) return formatSince(oldest);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export function OwedTable({ rows, today }: { rows: OwedCustomerRow[]; today: string }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [wheres, setWheres] = useState<PaymentsWhere[]>([]);
  const needle = search.trim().toLowerCase();
  const owingAll = rows.filter((row) => row.owedAmount > 0);
  const owing = owingAll.filter((row) => {
    if (needle) {
      const haystack = [row.name, row.phone, row.email].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    const since = row.oldestUnpaidDate?.slice(0, 10) ?? '';
    if (dateFrom && (!since || since < dateFrom)) return false;
    if (dateTo && (!since || since > dateTo)) return false;
    for (const where of wheres) {
      if (!where.field || !where.value) continue;
      if (where.field === 'customer' && row.name !== where.value) return false;
      if (where.field === 'visits' && String(row.unpaidVisitCount) !== where.value) return false;
    }
    return true;
  });
  const customerOptions = [...new Set(owingAll.map((row) => row.name))].sort().map((name) => ({
    value: name,
    label: name,
  }));
  const visitOptions = [...new Set(owingAll.map((row) => row.unpaidVisitCount))]
    .sort((a, b) => a - b)
    .map((count) => ({
      value: String(count),
      label: count === 1 ? '1 visit' : `${count} visits`,
    }));
  const whereActive = wheres.some((where) => where.field && where.value);
  const [payingId, setPayingId] = useState<string | null>(null);
  const paying = owing.find((row) => row.customerId === payingId) ?? null;

  const filters = (
    <PaymentsListFilters
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Name, phone, email…"
      dateLabel="Owed since"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateChange={({ date_from, date_to }) => {
        setDateFrom(date_from);
        setDateTo(date_to);
      }}
      fields={[
        { key: 'customer', label: 'Customer', options: customerOptions },
        { key: 'visits', label: 'Visits', options: visitOptions },
      ]}
      wheres={wheres}
      onWheresChange={setWheres}
      hasFilters={needle.length > 0 || Boolean(dateFrom || dateTo) || whereActive}
      onClear={() => {
        setSearch('');
        setDateFrom(undefined);
        setDateTo(undefined);
        setWheres([]);
      }}
    />
  );

  if (owingAll.length === 0) {
    return (
      <Card className="glass-card border-border/80">
        <CardContent className="flex min-h-[180px] flex-col items-center justify-center p-8 text-center">
          <p className="text-sm font-medium text-foreground">Nobody is overdue</p>
          <p className="mt-1 text-sm text-muted-foreground">Every customer is paid up.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {filters}
      {owing.length === 0 ? (
        <Card className="glass-card border-border/80">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing matches.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {owing.map((row) => (
            <MoneyRow
              key={row.customerId}
              accent={MONEY_ACCENT.overdue}
              icon={CircleAlert}
              title={row.name}
              detail={`${waitingLabel(row.oldestUnpaidDate, today)} · since ${formatSince(row.oldestUnpaidDate)} · ${row.unpaidVisitCount === 1 ? '1 visit' : `${row.unpaidVisitCount} visits`}`}
              amount={formatGbp(row.owedAmount)}
              tags={
                row.collectingAmount > 0 || row.hasDirectDebit || row.failedDirectDebits > 0 ? (
                  <>
                    {row.collectingAmount > 0 ? (
                      <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                        Collecting {formatGbp(row.collectingAmount)}
                      </span>
                    ) : null}
                    {row.hasDirectDebit ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        DD
                      </span>
                    ) : null}
                    {row.failedDirectDebits > 0 ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                        DD failed
                      </span>
                    ) : null}
                  </>
                ) : undefined
              }
              status={row.chaseStage === 2 ? 'Chase' : row.chaseStage === 1 ? 'Reminded' : undefined}
              onClick={() => router.push(`/customers/${row.customerId}`)}
              actions={
                <>
                  {row.phone ? (
                    <a
                      href={`tel:${row.phone}`}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <Phone className="size-3.5" />
                      Call
                    </a>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={() => setPayingId(row.customerId)}>
                    Mark as paid
                  </Button>
                  <CopyPayLinkButton customerId={row.customerId} available />
                </>
              }
            />
          ))}
        </ul>
      )}
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
    </div>
  );
}
