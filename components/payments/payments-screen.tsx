'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CircleAlert, FileText, LayoutDashboard, Wallet } from 'lucide-react';
import {
  SummaryStrip,
  type SummaryStripItem,
} from '@/components/jobs/status-summary-strip';
import { CardPaymentsPanel } from '@/components/payments/card-payments-panel';
import { GetPaidChecklist } from '@/components/payments/get-paid-checklist';
import { InvoicesTable } from '@/components/payments/invoices-table';
import { OwedTable } from '@/components/payments/owed-table';
import { PaymentsHistoryTable } from '@/components/payments/payments-history-table';
import { PaymentsOverview } from '@/components/payments/payments-overview';
import type { CardPanelData } from '@/lib/data/payments/card-panel';
import type { GetPaidChecklist as Checklist } from '@/lib/data/payments/checklist';
import type { EarningsOverview, PaymentHistoryRow } from '@/lib/data/payments/history';
import type { InvoiceRecord } from '@/lib/data/payments/invoices';
import type { OwedCustomerRow } from '@/lib/data/payments/owed';
import { formatGbp } from '@/lib/money/pence';

export type PaymentsView = 'overdue' | 'received' | 'overview' | 'invoices';

export function PaymentsScreen({
  view,
  checklist,
  cardPanel,
  connectDone = false,
  owedRows,
  owedError,
  historyRows,
  historyError,
  invoices,
  invoicesError,
  overdueAmount,
  receivedAmount,
  earnings,
  today,
  filters,
}: {
  view: PaymentsView;
  checklist: Checklist;
  cardPanel: CardPanelData;
  connectDone?: boolean;
  owedRows: OwedCustomerRow[];
  owedError: string | null;
  historyRows: PaymentHistoryRow[];
  historyError: string | null;
  invoices: InvoiceRecord[];
  invoicesError: string | null;
  overdueAmount: number;
  receivedAmount: number;
  earnings: EarningsOverview;
  today: string;
  filters: { from?: string; to?: string };
}) {
  const router = useRouter();
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

  const items: SummaryStripItem[] = [
    {
      key: 'overview',
      title: 'Overview',
      icon: LayoutDashboard,
      glow: 'rgb(245 158 11)',
      count: formatGbp(earnings.month),
    },
    {
      key: 'received',
      title: 'Came in',
      icon: Wallet,
      glow: 'rgb(16 185 129)',
      count: formatGbp(receivedAmount),
    },
    {
      key: 'overdue',
      title: 'Outstanding',
      icon: CircleAlert,
      glow: 'rgb(225 29 72)',
      count: formatGbp(overdueAmount),
    },
    {
      key: 'invoices',
      title: 'Invoices',
      icon: FileText,
      glow: 'rgb(79 70 229)',
      count: String(invoices.length),
    },
  ];

  const openView = (next: PaymentsView) => {
    if (next === 'overview') {
      router.push('/payments');
      return;
    }
    if (next === 'overdue') {
      router.push('/payments?view=overdue');
      return;
    }
    if (next === 'invoices') {
      router.push('/payments?tab=invoices');
      return;
    }
    const params = new URLSearchParams();
    params.set('view', next);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    router.push(`/payments?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <CardPaymentsPanel data={cardPanel} compact={compactCard} />
      <GetPaidChecklist
        checklist={checklist}
        settingsHref="/settings?tab=payments"
        logoHref="/settings?tab=company"
      />
      <SummaryStrip
        label="Money"
        hint="· click to see the list"
        activeKey={view}
        onSelect={(key) => {
          if (key === 'overdue' || key === 'received' || key === 'overview' || key === 'invoices') {
            openView(key);
          }
        }}
        items={items}
        gridClassName="grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
      />
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
          <OwedTable rows={owedRows} today={today} />
        )
      ) : view === 'overview' ? (
        <PaymentsOverview earnings={earnings} owed={overdueAmount} today={today} />
      ) : historyError ? (
        <p className="text-sm text-destructive">{historyError}</p>
      ) : (
        <PaymentsHistoryTable
          rows={historyRows}
          view="received"
          filters={filters}
        />
      )}
    </div>
  );
}
