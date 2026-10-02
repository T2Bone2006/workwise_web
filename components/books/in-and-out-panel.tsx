import Link from 'next/link';
import type { BooksSummary } from '@/lib/books/summary-pure';
import { formatGbp } from '@/lib/money/pence';
import { paymentMethodLabel } from '@/lib/payments/method-labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type InAndOutPanelProps = {
  summary: BooksSummary;
  audience: 'trader' | 'accountant';
  /** Where a month's name in the tax-year table goes. Omit for plain text. */
  monthHref?: (year: number, month: number) => string;
};

const money = (n: number) => formatGbp(n, { always2dp: true });

function Amount({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tabular-nums', value < 0 && 'text-destructive', className)}>{money(value)}</span>;
}

/** Presentational only: formats a BooksSummary. No data fetching, no actions. */
export function InAndOutPanel({ summary, audience, monthHref }: InAndOutPanelProps) {
  const { period, vat } = summary;
  const empty = summary.paymentsCount === 0 && summary.moneyOut === 0;
  const spentCategories = summary.moneyOutByCategory;

  return (
    <div className="space-y-5">
      {empty ? (
        <p className="rounded-xl border border-dashed border-border/80 px-4 py-3 text-sm text-muted-foreground">
          Nothing in or out in {period.label.replace(' tax year', '')}.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Money in</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
              <Amount value={summary.moneyIn} />
            </p>
            <p className="text-xs text-muted-foreground">
              from {summary.paymentsCount} {summary.paymentsCount === 1 ? 'payment' : 'payments'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Money out</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              <Amount value={summary.moneyOut} />
            </p>
            <p className="text-xs text-muted-foreground">expenses you&apos;ve saved</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Left</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              <Amount value={summary.left} />
            </p>
            <p className="text-xs text-muted-foreground">money in less money out</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Money in, by how they paid</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.moneyInByMethod.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments in this period.</p>
            ) : (
              <ul className="divide-y">
                {summary.moneyInByMethod.map((row) => (
                  <li key={row.method} className="flex items-center justify-between py-2 text-sm">
                    <span>{paymentMethodLabel(row.method)}</span>
                    <Amount value={row.amount} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Money out, by category</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {spentCategories.map((row) => (
                <li
                  key={row.category}
                  className={cn('flex items-center justify-between py-2 text-sm', row.count === 0 && 'text-muted-foreground/60')}
                >
                  <span>
                    {row.label}
                    {row.count > 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.count} {row.count === 1 ? 'expense' : 'expenses'}
                      </span>
                    ) : null}
                  </span>
                  <Amount value={row.amount} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {vat ? (
        <Card>
          <CardHeader>
            <CardTitle>VAT</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>VAT on your expenses</span>
              <Amount value={vat.vatOut} />
            </div>
            <div className="flex items-center justify-between">
              <span>VAT in your takings (estimate)</span>
              <Amount value={vat.vatInEstimate} />
            </div>
            <p className="text-xs text-muted-foreground">
              Estimate at {vat.rate}% — your accountant will confirm.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {summary.months ? (
        <Card>
          <CardHeader>
            <CardTitle>Month by month</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.months.map((m) => {
                  const left = Math.round((m.moneyIn - m.moneyOut) * 100) / 100;
                  return (
                    <TableRow key={`${m.year}-${m.month}`}>
                      <TableCell>
                        {monthHref ? (
                          <Link href={monthHref(m.year, m.month)} className="text-primary hover:underline">
                            {m.label}
                          </Link>
                        ) : (
                          m.label
                        )}
                      </TableCell>
                      <TableCell className="text-right"><Amount value={m.moneyIn} /></TableCell>
                      <TableCell className="text-right"><Amount value={m.moneyOut} /></TableCell>
                      <TableCell className="text-right"><Amount value={left} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {audience === 'trader' ? (
        <p className="text-xs text-muted-foreground">
          Money in is counted on the day it arrived. Expenses count once you&apos;ve saved them.
        </p>
      ) : null}
    </div>
  );
}
