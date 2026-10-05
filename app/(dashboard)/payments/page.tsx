import { redirect } from 'next/navigation';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { PaymentsActions } from '@/components/payments/payments-actions';
import {
  PaymentsScreen,
  type PaymentsView,
} from '@/components/payments/payments-screen';
import { getCardPanelParts } from '@/lib/data/payments/card-panel';
import { getGetPaidChecklist } from '@/lib/data/payments/checklist';
import { getEarningsOverview, getPaymentHistory } from '@/lib/data/payments/history';
import { listInvoices } from '@/lib/data/payments/invoices';
import { getDirectDebitState } from '@/lib/direct-debit/state';
import { getOwedCustomers } from '@/lib/data/payments/owed';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { addDays, isValidYmd, londonDayBoundsUtc, todayInLondon } from '@/lib/rounds/dates';
import { createClient } from '@/lib/supabase/server';

interface PaymentsPageProps {
  searchParams: Promise<{
    tab?: string;
    view?: string;
    from?: string;
    to?: string;
    all?: string;
    connect?: string;
    age?: string;
  }>;
}

function resolveView(raw: { tab?: string; view?: string }): PaymentsView {
  if (raw.view === 'received' || raw.view === 'overview' || raw.view === 'overdue') {
    return raw.view;
  }
  if (raw.view === 'today') return 'overview';
  if (raw.tab === 'payments') return 'received';
  if (raw.tab === 'invoices' || raw.view === 'invoices') return 'invoices';
  return 'overview';
}

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) redirect('/login');
  if (!products.hasRounds) redirect('/dashboard');

  const raw = await searchParams;
  const view = resolveView(raw);
  const today = todayInLondon();
  const defaultFrom = addDays(today, -29);
  const allDates = raw.all === '1';
  const from = allDates ? undefined : raw.from && isValidYmd(raw.from) ? raw.from : defaultFrom;
  const to = allDates ? undefined : raw.to && isValidYmd(raw.to) ? raw.to : today;

  const supabase = await createClient();
  const fromBounds = from ? londonDayBoundsUtc(from) : null;
  const toBounds = to ? londonDayBoundsUtc(to) : null;

  const connectDone = raw.connect === 'done';
  const [checklist, cardParts, owedAll, history, earnings, invoicesResult, ddState] = await Promise.all([
    getGetPaidChecklist(supabase, tenantId),
    getCardPanelParts(supabase, tenantId, { refresh: connectDone }),
    getOwedCustomers(supabase, tenantId),
    getPaymentHistory(supabase, tenantId, {
      from: fromBounds?.startIso,
      to: toBounds?.endIso,
      includeVoid: false,
      limit: 200,
    }),
    getEarningsOverview(supabase, tenantId, today),
    listInvoices(supabase, tenantId).then(
      (rows) => ({ rows, error: null as string | null }),
      (error: unknown) => ({
        rows: [],
        error: error instanceof Error ? error.message : 'Could not load invoices.',
      }),
    ),
    getDirectDebitState(supabase, tenantId),
  ]);
  // Direct Debit only shows when the business has it On (D10).
  const owed =
    ddState === 'on'
      ? owedAll
      : {
          ...owedAll,
          rows: owedAll.rows.map((row) => ({
            ...row,
            collectingAmount: 0,
            hasDirectDebit: false,
            failedDirectDebits: 0,
          })),
        };

  const customers = await supabase
    .from('customers')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(5000);
  const pickable = ((customers.data ?? []) as { id: string; name: string | null }[])
    .filter((c) => c.name)
    .map((c) => ({ id: c.id, name: c.name as string }));
  const owedByCustomer = Object.fromEntries(
    owed.rows.filter((row) => row.owedAmount > 0).map((row) => [row.customerId, row.owedAmount]),
  );
  const owedBand = raw.age === 'old' || raw.age === 'mid' || raw.age === 'new' ? raw.age : 'all';

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Payments"
        subtitle="Who owes you, what has come in, and what to do about it."
        actions={<PaymentsActions customers={pickable} owedByCustomer={owedByCustomer} />}
      />
      <PaymentsScreen
        view={view}
        checklist={checklist}
        cardPanel={cardParts.data}
        payoutsPromise={cardParts.payoutsPromise}
        connectDone={connectDone}
        owedRows={owed.rows}
        owedError={owed.error}
        historyRows={history.rows}
        historyError={history.error}
        invoices={invoicesResult.rows}
        invoicesError={invoicesResult.error}
        earnings={earnings}
        today={today}
        filters={{ from, to }}
        owedBand={owedBand}
      />
    </div>
  );
}
