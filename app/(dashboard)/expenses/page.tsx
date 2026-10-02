import { redirect } from 'next/navigation';
import { InAndOutPanel } from '@/components/books/in-and-out-panel';
import { PeriodPicker } from '@/components/books/period-picker';
import { ExpensesTabs } from '@/components/expenses/expenses-tabs';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { Card, CardContent } from '@/components/ui/card';
import {
  currentMonth,
  londonDateOf,
  parsePeriodParam,
  periodParam,
  periodRange,
  taxYearFor,
  type Period,
} from '@/lib/books/periods';
import { loadBooksSummary } from '@/lib/books/summary';
import { getVatRegistered, listDraftExpenses, listExpenses } from '@/lib/data/expenses';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { todayInLondon } from '@/lib/rounds/dates';
import { createClient } from '@/lib/supabase/server';

interface ExpensesPageProps {
  searchParams: Promise<{ tab?: string; period?: string }>;
}

type MonthPeriod = Extract<Period, { kind: 'month' }>;

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const [tenantId, products] = await Promise.all([getTenantIdForCurrentUser(), getTenantProducts()]);
  if (!tenantId) redirect('/login');
  if (!products.hasRounds) redirect('/dashboard');

  const raw = await searchParams;
  const tab = raw.tab === 'in-out' ? 'in-out' : 'expenses';
  const today = todayInLondon();
  const currentPeriod = currentMonth(today) as MonthPeriod;
  const parsed = parsePeriodParam(raw.period, today);
  const supabase = await createClient();

  // Expenses tab: always by month (a tax-year link falls back to this month).
  const expensesPeriod: MonthPeriod = parsed.kind === 'month' ? parsed : currentPeriod;

  const [drafts, expenses, vatRegistered] =
    tab === 'expenses'
      ? await Promise.all([
          listDraftExpenses(supabase, tenantId),
          listExpenses(supabase, tenantId, periodRange(expensesPeriod)),
          getVatRegistered(supabase, tenantId),
        ])
      : [[], [], await getVatRegistered(supabase, tenantId)];

  let inOutPanel: React.ReactNode = null;
  if (tab === 'in-out') {
    const { data: tenant } = await supabase.from('tenants').select('created_at').eq('id', tenantId).maybeSingle();
    const createdYear = tenant?.created_at ? taxYearFor(londonDateOf(tenant.created_at)) : taxYearFor(today);
    // Always offer last tax year too, so someone starting mid-year can look back at it.
    const earliestTaxYear = Math.min(createdYear, taxYearFor(today) - 1);

    let summary;
    try {
      summary = await loadBooksSummary(supabase, { tenantId, period: parsed });
    } catch {
      summary = null;
    }

    inOutPanel = (
      <div className="space-y-5">
        <PeriodPicker value={parsed} basePath="/expenses?tab=in-out" earliestTaxYear={earliestTaxYear} today={today} />
        {summary ? (
          <InAndOutPanel
            summary={summary}
            audience="trader"
            monthHref={(year, month) => `/expenses?tab=in-out&period=${periodParam({ kind: 'month', year, month })}`}
          />
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Couldn&apos;t load your numbers. Refresh to try again.
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageGradientHeader title="Expenses" subtitle="What you've spent, and money in and out." />
      <ExpensesTabs
        tab={tab}
        drafts={drafts}
        expenses={expenses}
        period={expensesPeriod}
        currentPeriod={currentPeriod}
        vatRegistered={vatRegistered}
        inOutPanel={inOutPanel}
      />
    </div>
  );
}
