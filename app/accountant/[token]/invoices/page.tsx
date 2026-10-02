import { InvoicesList } from '@/components/accountant/invoices-list';
import { PageHeader } from '@/components/accountant/page-header';
import { PeriodPicker } from '@/components/books/period-picker';
import { Card, CardContent } from '@/components/ui/card';
import { requireAccountantPage } from '@/lib/accountant/context';
import { accountantPeriod } from '@/lib/accountant/period';
import { periodRange } from '@/lib/books/periods';
import { accountantEarliestTaxYear, accountantInvoices, type AccountantInvoiceRow } from '@/lib/data/accountant';
import { getVatRegistered } from '@/lib/data/expenses';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const STATUS_PARAMS = { paid: 'Paid', unpaid: 'Unpaid', overdue: 'Overdue', cancelled: 'Cancelled' } as const;

export default async function AccountantInvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ period?: string; status?: string }>;
}) {
  const { token } = await params;
  const ctx = await requireAccountantPage(token);
  const raw = await searchParams;
  const today = todayInLondon();
  const period = accountantPeriod(raw.period, today);
  const range = periodRange(period);
  const admin = createAdminClient();
  const base = `/accountant/${token}`;

  let invoices: AccountantInvoiceRow[] | null = null;
  let earliest = 0;
  let vatRegistered = false;
  try {
    [invoices, earliest, vatRegistered] = await Promise.all([
      accountantInvoices(admin, ctx.tenantId, range),
      accountantEarliestTaxYear(admin, ctx.tenantId),
      getVatRegistered(admin, ctx.tenantId),
    ]);
  } catch {
    invoices = null;
  }

  const initialStatus = STATUS_PARAMS[(raw.status ?? '') as keyof typeof STATUS_PARAMS] ?? 'All';

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" periodLabel={range.label} businessName={ctx.businessName} />
      <div className="print:hidden">
        <PeriodPicker value={period} basePath={`${base}/invoices`} earliestTaxYear={earliest} today={today} />
      </div>
      {invoices == null ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Couldn&apos;t load the invoices. Refresh to try again.
          </CardContent>
        </Card>
      ) : (
        <InvoicesList
          rows={invoices}
          base={base}
          initialStatus={initialStatus}
          periodLabel={range.label}
          vatRegistered={vatRegistered}
        />
      )}
    </div>
  );
}
