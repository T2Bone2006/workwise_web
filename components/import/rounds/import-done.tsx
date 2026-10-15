'use client';

import Link from 'next/link';
import { CheckCircle2, PoundSterling, Repeat, Users } from 'lucide-react';
import { IconChip, StatTile } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StuckLink } from '@/components/import/rounds/stuck-link';
import type { AfterImportDirectDebit } from '@/lib/actions/rounds/import-after';
import type { ImportRoundsResult } from '@/lib/actions/rounds/import';
import { isImportableCustomerRow, type PreparedCustomerRow } from '@/lib/import/extracted-customer-row';
import { formatGbp } from '@/lib/money/pence';

type Saved = Extract<ImportRoundsResult, { success: true }>;

/** Pounds actually recorded. Matched customers and failed charges are left out. */
export function owedPoundsAdded(rows: PreparedCustomerRow[], errors: Saved['errors']): number {
  const byRow = new Map<number, string[]>();
  for (const error of errors) {
    const list = byRow.get(error.rowIndex) ?? [];
    list.push(error.error);
    byRow.set(error.rowIndex, list);
  }
  let sum = 0;
  for (const row of rows) {
    if (!isImportableCustomerRow(row) || row.balanceOwed == null || row.balanceOwed <= 0) continue;
    const messages = byRow.get(row.rowIndex) ?? [];
    if (messages.some((m) => m === 'Already here — owed amount not added' || m.startsWith("Couldn't add the "))) {
      continue;
    }
    if (messages.some((m) => !savedAfterTheCustomer(m))) continue;
    sum += row.balanceOwed;
  }
  return Math.round(sum * 100) / 100;
}

/** Errors that only happen once the customer row exists, so a starting balance may already be saved. */
function savedAfterTheCustomer(message: string): boolean {
  return (
    message === 'This row is missing a price or how often.' ||
    message === "Couldn't pause this customer." ||
    message === 'Failed to pause agreement' ||
    message === 'Agreement not found' ||
    message === 'This agreement has ended' ||
    message === 'Failed to create agreement' ||
    message === 'Customer not found' ||
    message === 'Service not found' ||
    message.startsWith('Agreement saved')
  );
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadFailedRows(errors: Saved['errors']) {
  const lines = ['Name,What to check', ...errors.map((e) => `${csvCell(e.name)},${csvCell(e.error)}`)];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'import-rows-to-check.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function linkedSentence(linked: number): string {
  return linked === 1
    ? '1 existing Direct Debit linked automatically.'
    : `${linked} existing Direct Debits linked automatically.`;
}

export function ImportDone({
  result,
  rows,
  directDebit,
  directDebitCheckFailed,
}: {
  result: Saved;
  rows: PreparedCustomerRow[];
  directDebit: AfterImportDirectDebit | null;
  directDebitCheckFailed: boolean;
}) {
  const owed = owedPoundsAdded(rows, result.errors);
  const toCheck = directDebit ? directDebit.toCheck + directDebit.notMatched : 0;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-(--tone-emerald-line) bg-(--tone-emerald-soft) p-5 shadow-(--look-card-shadow)">
        <div className="flex items-start gap-3">
          <IconChip icon={CheckCircle2} tone="emerald" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">Your round is in</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {result.customersCreated === 0
                ? 'Everything in this file was already here.'
                : `${result.customersCreated} ${result.customersCreated === 1 ? 'customer is' : 'customers are'} ready on your calendar.`}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatTile label="Customers added" value={String(result.customersCreated)} tone="emerald" icon={Users} sub={result.customersMatched > 0 ? `${result.customersMatched} were already here` : 'New to WorkWise'} />
          <StatTile label="Regular services" value={String(result.agreementsCreated)} tone="rounds" icon={Repeat} sub={`${result.visitsGenerated} visits on your calendar${result.paused > 0 ? `, ${result.paused} paused` : ''}`} />
          <StatTile label="Owed from before" value={formatGbp(owed)} tone={owed > 0 ? 'rose' : 'slate'} icon={PoundSterling} sub={result.balancesAdded > 0 ? `added to ${result.balancesAdded} ${result.balancesAdded === 1 ? 'customer' : 'customers'}` : 'Nothing carried over'} />
        </div>
      </section>

      <Card className="glass-card gap-4 p-5">
      {directDebit && !directDebitCheckFailed && (
        <div className="space-y-1 text-sm">
          <p>{linkedSentence(directDebit.linked)}</p>
          {toCheck > 0 && (
            <p>
              {toCheck} need you to check —{' '}
              <Link href="/payments/direct-debits" className="font-semibold text-sky-700 hover:underline dark:text-sky-300">
                Link existing Direct Debits
              </Link>
            </p>
          )}
        </div>
      )}

      {directDebitCheckFailed && (
        <p className="text-sm">
          We couldn&apos;t check your Direct Debits just now — they&apos;ll be matched on the{' '}
          <Link href="/payments/direct-debits" className="font-medium text-sky-700 hover:underline dark:text-sky-300">
            Direct Debits page
          </Link>
          .
        </p>
      )}

      {result.errors.length > 0 && (
        <details className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-800 dark:text-amber-200">
            {result.errors.length} rows need a look
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-amber-900 dark:text-amber-100">
            {result.errors.map((err) => (
              <li key={`${err.rowIndex}-${err.error}`}>
                {err.name ? <span className="font-medium">{err.name}: </span> : null}
                {err.error}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => downloadFailedRows(result.errors)}>
            Download these rows
          </Button>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/customers">See your customers</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/calendar">Open the calendar</Link>
        </Button>
      </div>

      <StuckLink context="done" />
      </Card>
    </div>
  );
}
