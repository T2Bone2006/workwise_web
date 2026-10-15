import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { groupByHmrcHeading } from '@/lib/books/hmrc';
import type { BooksSummary } from '@/lib/books/summary-pure';
import type { AccountantFlags } from '@/lib/data/accountant';
import { formatGbp } from '@/lib/money/pence';
import { paymentMethodLabel } from '@/lib/payments/method-labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const money = (n: number) => formatGbp(n, { always2dp: true });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Amount({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tabular-nums', value < 0 && 'text-destructive', className)}>{money(value)}</span>;
}

function Tile({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <Card className="gap-1 rounded-2xl py-4">
      <CardContent>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums">{children}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

type Flag = { key: string; text: string; href?: string; tone: 'warn' | 'info' };

function flagsFrom(flags: AccountantFlags, base: string): Flag[] {
  const out: Flag[] = [];
  if (flags.noReceipt.count > 0) {
    out.push({
      key: 'no-receipt',
      tone: 'warn',
      text: `${plural(flags.noReceipt.count, 'expense has', 'expenses have')} no receipt photo (${money(flags.noReceipt.amount)})`,
      href: `${base}/expenses?filter=no-receipt`,
    });
  }
  if (flags.unchecked > 0) {
    out.push({
      key: 'unchecked',
      tone: 'warn',
      text: `${plural(flags.unchecked, 'scanned receipt hasn’t', 'scanned receipts haven’t')} been checked by the business yet, so ${flags.unchecked === 1 ? 'it isn’t' : 'they aren’t'} counted above`,
    });
  }
  if (flags.refundedInFull.count > 0) {
    out.push({
      key: 'refund-full',
      tone: 'info',
      text: `${plural(flags.refundedInFull.count, 'payment was', 'payments were')} refunded in full (${money(flags.refundedInFull.amount)}), so ${flags.refundedInFull.count === 1 ? 'it isn’t' : 'they aren’t'} counted as money in`,
      href: `${base}/payments?filter=refunded`,
    });
  }
  if (flags.refundedInPart.count > 0) {
    out.push({
      key: 'refund-part',
      tone: 'info',
      text: `${plural(flags.refundedInPart.count, 'payment was', 'payments were')} part-refunded (${money(flags.refundedInPart.amount)} given back); only the rest is counted`,
      href: `${base}/payments?filter=refunded`,
    });
  }
  if (flags.owed.amount > 0) {
    out.push({
      key: 'owed',
      tone: 'info',
      text: `${money(flags.owed.amount)} is owed by ${plural(flags.owed.customers, 'customer', 'customers')} today`,
      href: `${base}/invoices?status=unpaid`,
    });
  }
  return out;
}

/**
 * The page an accountant lands on: the three numbers, then the breakdowns they
 * file from, then anything they'd want to ask about. Presentational only.
 */
export function AccountantSummary({
  summary,
  flags,
  base,
}: {
  summary: BooksSummary;
  /** null when the checks couldn't be loaded: the box is left out rather than showing a wrong "all clear". */
  flags: AccountantFlags | null;
  base: string;
}) {
  const hmrc = groupByHmrcHeading(summary.moneyOutByCategory);
  const showVat = summary.vat != null;
  const maxMonth = Math.max(0, ...(summary.months ?? []).map((m) => m.moneyIn));
  const flagList = flags ? flagsFrom(flags, base) : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Money in" hint={`${plural(summary.paymentsCount, 'payment', 'payments')} received`}>
          <span className="text-(--tone-emerald-solid)">{money(summary.moneyIn)}</span>
        </Tile>
        <Tile label="Money out" hint="expenses the business has saved">
          <span className="text-(--tone-rose-solid)">{money(summary.moneyOut)}</span>
        </Tile>
        <Tile label="Left" hint="money in less money out, before tax">
          <Amount value={summary.left} />
        </Tile>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expenses by HMRC heading</CardTitle>
          </CardHeader>
          <CardContent>
            {hmrc.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Heading</TableHead>
                    {showVat ? <TableHead className="text-right">VAT</TableHead> : null}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hmrc.map((row) => (
                    <TableRow key={row.heading}>
                      <TableCell className="whitespace-normal">
                        <span className="block">{row.heading}</span>
                        <span className="text-xs text-muted-foreground">
                          {row.categories.join(', ')} · {plural(row.count, 'expense', 'expenses')}
                        </span>
                      </TableCell>
                      {showVat ? (
                        <TableCell className="text-right"><Amount value={row.vatAmount} /></TableCell>
                      ) : null}
                      <TableCell className="text-right"><Amount value={row.amount} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">Total</TableCell>
                    {showVat ? (
                      <TableCell className="text-right"><Amount value={summary.vat?.vatOut ?? 0} /></TableCell>
                    ) : null}
                    <TableCell className="text-right font-medium"><Amount value={summary.moneyOut} /></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{summary.months ? 'Month by month' : 'Money in, by how they paid'}</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.months ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="w-1/3"><span className="sr-only">Money in, as a bar</span></TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.months.map((m) => (
                    <TableRow key={`${m.year}-${m.month}`}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`${base}?period=m-${m.year}-${String(m.month).padStart(2, '0')}`} className="hover:underline">
                          {m.label.replace(/ \d{4}$/, '')}
                        </Link>
                      </TableCell>
                      <TableCell aria-hidden="true">
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-emerald-500/70"
                            style={{ width: maxMonth > 0 ? `${Math.round((m.moneyIn / maxMonth) * 100)}%` : '0%' }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right"><Amount value={m.moneyIn} /></TableCell>
                      <TableCell className="text-right"><Amount value={m.moneyOut} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : summary.moneyInByMethod.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments in this period.</p>
            ) : (
              <ul className="divide-y text-sm">
                {summary.moneyInByMethod.map((row) => (
                  <li key={row.method} className="flex items-center justify-between py-2">
                    <span>{paymentMethodLabel(row.method)}</span>
                    <Amount value={row.amount} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {summary.months ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Money in, by how they paid</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.moneyInByMethod.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments in this period.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {summary.moneyInByMethod.map((row) => (
                    <li key={row.method} className="flex items-center justify-between py-2">
                      <span>{paymentMethodLabel(row.method)}</span>
                      <Amount value={row.amount} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {summary.vat ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">VAT</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>VAT on expenses</span>
                <Amount value={summary.vat.vatOut} />
              </div>
              <div className="flex items-center justify-between">
                <span>VAT in takings (estimate)</span>
                <Amount value={summary.vat.vatInEstimate} />
              </div>
              <p className="text-xs text-muted-foreground">
                The estimate takes {summary.vat.rate}% VAT out of money in. Check it against the invoices.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {flagList ? (
        <Card className={cn(flagList.length > 0 ? 'border-amber-300/70 dark:border-amber-400/30' : 'border-emerald-300/70 dark:border-emerald-400/30')}>
          <CardHeader>
            <CardTitle className="text-base">Worth a look</CardTitle>
          </CardHeader>
          <CardContent>
            {flagList.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                Nothing to flag: every saved expense has a receipt and nothing is waiting to be checked.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {flagList.map((flag) => (
                  <li key={flag.key} className="flex items-start gap-2">
                    <AlertCircle
                      className={cn('mt-0.5 size-4 shrink-0', flag.tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground')}
                      aria-hidden="true"
                    />
                    {flag.href ? (
                      <Link href={flag.href} className="hover:underline">{flag.text}</Link>
                    ) : (
                      <span>{flag.text}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Money in is counted on the day it arrived; expenses on the day they were spent. Only saved expenses count.
      </p>
    </div>
  );
}
