'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { PageTabs } from '@/components/look';
import { CardPaymentsPanel } from '@/components/payments/card-payments-panel';
import { GetPaidChecklist } from '@/components/payments/get-paid-checklist';
import { InvoicesTable } from '@/components/payments/invoices-table';
import { OwedTable } from '@/components/payments/owed-table';
import { PaymentsHistoryTable } from '@/components/payments/payments-history-table';
import { PaymentsOverview } from '@/components/payments/payments-overview';
import type { OwedBand } from '@/components/payments/owed-age';
import type { CardPanelData } from '@/lib/data/payments/card-panel';
import type { GetPaidChecklist as Checklist } from '@/lib/data/payments/checklist';
import type { EarningsOverview, PaymentHistoryRow } from '@/lib/data/payments/history';
import type { InvoiceRecord } from '@/lib/data/payments/invoices';
import type { OwedCustomerRow } from '@/lib/data/payments/owed';

export type PaymentsView = 'overdue' | 'received' | 'overview' | 'invoices';

export function PaymentsScreen({
  view,
  checklist,
  cardPanel,
  payoutsPromise = null,
  connectDone = false,
  owedRows,
  owedError,
  historyRows,
  historyError,
  invoices,
  invoicesError,
  earnings,
  today,
  filters,
  owedBand = 'all',
}: {
  view: PaymentsView;
  checklist: Checklist;
  cardPanel: CardPanelData;
  /** Live Stripe balance, still loading when the page first renders. */
  payoutsPromise?: Promise<Pick<CardPanelData, 'payouts' | 'payoutsError'>> | null;
  connectDone?: boolean;
  owedRows: OwedCustomerRow[];
  owedError: string | null;
  historyRows: PaymentHistoryRow[];
  historyError: string | null;
  invoices: InvoiceRecord[];
  invoicesError: string | null;
  earnings: EarningsOverview;
  today: string;
  filters: { from?: string; to?: string };
  /** From the "how long they've waited" bar on the overview. */
  owedBand?: OwedBand | 'all';
}) {
  const toasted = useRef(false);

  useEffect(() => {
    if (!connectDone || toasted.current) return;
    toasted.current = true;
    if (cardPanel.status === 'active') {
      toast.success('Card payment setup saved');
    } else {
      toast.success('Saved — Stripe is checking your details');
    }
  }, [connectDone, cardPanel.status]);

  const compactCard = cardPanel.status === 'active' && cardPanel.disputes.length === 0;

  const owingCount = owedRows.filter((row) => row.owedAmount > 0).length;
  const tabs: { key: PaymentsView; label: string; href: string; count?: number; countTone?: 'rose' }[] = [
    { key: 'overview', label: 'Overview', href: '/payments' },
    { key: 'overdue', label: 'Who owes', href: '/payments?view=overdue', count: owingCount, countTone: 'rose' },
    { key: 'received', label: 'Came in', href: '/payments?view=received' },
    { key: 'invoices', label: 'Invoices', href: '/payments?tab=invoices', count: invoices.length },
  ];

  return (
    <div className="space-y-6">
      <CardPaymentsPanel data={cardPanel} payoutsPromise={payoutsPromise} compact={compactCard} />
      <GetPaidChecklist
        checklist={checklist}
        settingsHref="/settings?tab=payments"
        logoHref="/settings?tab=company"
      />
      <PageTabs ariaLabel="Payments" items={tabs} active={view} />
      {view === 'invoices' ? (
        invoicesError ? (
          <p className="text-sm text-destructive">{invoicesError}</p>
        ) : (
          <InvoicesTable rows={invoices} />
        )
      ) : view === 'overdue' ? (
        owedError ? (
          <p className="text-sm text-destructive">{owedError}</p>
        ) : (
          <OwedTable rows={owedRows} today={today} initialBand={owedBand} />
        )
      ) : view === 'overview' ? (
        <PaymentsOverview
          earnings={earnings}
          owedRows={owedRows}
          historyRows={historyRows}
          today={today}
        />
      ) : historyError ? (
        <p className="text-sm text-destructive">{historyError}</p>
      ) : (
        <PaymentsHistoryTable rows={historyRows} filters={filters} today={today} />
      )}
    </div>
  );
}
