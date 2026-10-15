import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { AccountantSummary } from '@/components/accountant/accountant-summary';
import { PageHeader } from '@/components/accountant/page-header';
import { SignInPanel } from '@/components/accountant/sign-in-panel';
import { PeriodPicker } from '@/components/books/period-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireAccountant } from '@/lib/accountant/context';
import { accountantPeriod } from '@/lib/accountant/period';
import { periodRange } from '@/lib/books/periods';
import { loadBooksSummary } from '@/lib/books/summary';
import { accountantEarliestTaxYear, accountantFlags } from '@/lib/data/accountant';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function AccountantHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { token } = await params;
  const state = await requireAccountant(token);
  if (state.status === 'not_found') notFound();
  if (state.status === 'sign_in') {
    return <SignInPanel token={token} businessName={state.businessName} maskedEmail={state.maskedEmail} />;
  }

  const { ctx } = state;
  const today = todayInLondon();
  const period = accountantPeriod((await searchParams).period, today);
  const range = periodRange(period);
  const admin = createAdminClient();
  const base = `/accountant/${token}`;

  const [earliestTaxYear, summary, flags] = await Promise.all([
    accountantEarliestTaxYear(admin, ctx.tenantId),
    loadBooksSummary(admin, { tenantId: ctx.tenantId, period }).catch(() => null),
    accountantFlags(admin, ctx.tenantId, range).catch(() => null),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="Summary" periodLabel={range.label} businessName={ctx.businessName}>
        <Button asChild size="sm">
          <Link href={`${base}/downloads`}>
            <Download className="size-4" /> Year-end pack
          </Link>
        </Button>
      </PageHeader>
      <div className="print:hidden">
        <PeriodPicker value={period} basePath={base} earliestTaxYear={earliestTaxYear} today={today} />
      </div>
      {summary ? (
        <AccountantSummary summary={summary} flags={flags} base={base} />
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Couldn&apos;t load the numbers. Refresh to try again.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
