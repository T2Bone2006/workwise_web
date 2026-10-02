import { ExpensesList } from '@/components/accountant/expenses-list';
import { PageHeader } from '@/components/accountant/page-header';
import { PeriodPicker } from '@/components/books/period-picker';
import { Card, CardContent } from '@/components/ui/card';
import { requireAccountantPage } from '@/lib/accountant/context';
import { accountantPeriod } from '@/lib/accountant/period';
import { periodRange } from '@/lib/books/periods';
import { accountantEarliestTaxYear, accountantExpenses, type AccountantExpense } from '@/lib/data/accountant';
import { getVatRegistered } from '@/lib/data/expenses';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function AccountantExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ period?: string; filter?: string }>;
}) {
  const { token } = await params;
  const ctx = await requireAccountantPage(token);
  const raw = await searchParams;
  const today = todayInLondon();
  const period = accountantPeriod(raw.period, today);
  const range = periodRange(period);
  const admin = createAdminClient();

  let expenses: AccountantExpense[] | null = null;
  let earliest = 0;
  let vatRegistered = false;
  try {
    [expenses, earliest, vatRegistered] = await Promise.all([
      accountantExpenses(admin, ctx.tenantId, range),
      accountantEarliestTaxYear(admin, ctx.tenantId),
      getVatRegistered(admin, ctx.tenantId),
    ]);
  } catch {
    expenses = null;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Expenses" periodLabel={range.label} businessName={ctx.businessName} />
      <div className="print:hidden">
        <PeriodPicker value={period} basePath={`/accountant/${token}/expenses`} earliestTaxYear={earliest} today={today} />
      </div>
      {expenses == null ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Couldn&apos;t load the expenses. Refresh to try again.
          </CardContent>
        </Card>
      ) : (
        <ExpensesList
          rows={expenses}
          token={token}
          initialFilter={raw.filter === 'no-receipt' ? 'no-receipt' : 'all'}
          periodLabel={range.label}
          vatRegistered={vatRegistered || expenses.some((e) => e.vatAmount != null)}
        />
      )}
    </div>
  );
}
