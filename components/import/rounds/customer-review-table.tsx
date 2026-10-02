'use client';

import { Fragment, memo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, MinusCircle, Pencil, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatShortDate } from '@/components/rounds/overview/shared';
import {
  type CustomerRowEdits,
  type EditableCustomerField,
  type PreparedCustomerRow,
} from '@/lib/import/extracted-customer-row';
import { effectiveNextVisit } from '@/lib/import/review-helpers';
import { formatGbp } from '@/lib/money/pence';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';
import { frequencyLabel } from '@/lib/rounds/parse-frequency';
import type { Ymd } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';

type RowProps = {
  row: PreparedCustomerRow;
  repeatOf: number | null;
  defaultStart: Ymd | null;
  today: Ymd;
  onEdit: (rowIndex: number, field: EditableCustomerField, value: string) => void;
  /** Put a skipped row back in (an edit to status). */
  onUnskip: (rowIndex: number) => void;
};

/** Inline cell input: commits on blur or Enter, never on every keystroke. */
function EditableCell({
  value,
  label,
  invalid,
  onCommit,
  width = 'min-w-[110px]',
  inputMode,
}: {
  value: string;
  label: string;
  invalid: boolean;
  onCommit: (next: string) => void;
  width?: string;
  inputMode?: 'text' | 'decimal' | 'tel' | 'email';
}) {
  return (
    <Input
      key={value}
      defaultValue={value}
      aria-label={label}
      placeholder={label}
      inputMode={inputMode}
      aria-invalid={invalid || undefined}
      onBlur={(e) => {
        if (e.currentTarget.value !== value) onCommit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={cn('h-8 text-sm', width, invalid && 'border-rose-500 bg-rose-500/10 ring-1 ring-rose-500/40')}
    />
  );
}

/** Sits in the visible table width, so a wide row doesn't stretch the fields off to the side. */
function RowPanel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <TableRow className={className}>
      <TableCell colSpan={11} className="whitespace-normal p-0">
        <div className="sticky left-0 w-[min(48rem,100cqw)] max-w-full px-3 py-3">{children}</div>
      </TableCell>
    </TableRow>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground', className)}>
      {label}
      {children}
    </label>
  );
}

const STATUS_STYLE: Record<PreparedCustomerRow['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  paused: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  skip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
};
const STATUS_LABEL: Record<PreparedCustomerRow['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  skip: 'Left out',
};

const Row = memo(function Row({ row, repeatOf, defaultStart, today, onEdit, onUnskip }: RowProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const skipped = row.status === 'skip';
  const red = !row.ok;
  const bad = (field: EditableCustomerField) => row.errorFields.includes(field);
  // A row that still needs fixing opens its fields in a grid under the summary,
  // not as inputs squeezed into the table columns.
  const fixing = red && !skipped && !editing;
  const commit = (field: EditableCustomerField) => (value: string) => onEdit(row.rowIndex, field, value);
  const next = effectiveNextVisit(row, defaultStart, today);
  const sourceEntries = Object.entries(row.sourceFields);

  return (
    <Fragment>
      <TableRow
        className={cn(
          'align-top',
          red && 'bg-rose-500/[0.06] shadow-[inset_3px_0_0_0_rgb(244_63_94)]',
          skipped && 'bg-muted/40 text-muted-foreground'
        )}
      >
        <TableCell className="w-8 pr-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Hide what we read' : 'Show what we read'}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </TableCell>

        <TableCell className="min-w-[190px] max-w-[260px]">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              {skipped ? (
                <MinusCircle className="size-4 text-slate-400" aria-label="Left out" />
              ) : red ? (
                <span className="mt-1 inline-block size-2.5 rounded-full bg-rose-500" aria-label="Needs fixing" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-600" aria-label="Ready" />
              )}
            </span>
            <div className="min-w-0 space-y-1">
              <p className={cn('truncate font-medium', skipped && 'line-through decoration-slate-400/60')}>
                {row.name || <span className="text-muted-foreground">—</span>}
              </p>
              {skipped && row.skipReason && <p className="text-xs">{row.skipReason}</p>}
              {skipped && (
                <button type="button" onClick={() => onUnskip(row.rowIndex)} className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-300">
                  Import this one anyway
                </button>
              )}
              {row.errors.map((e) => (
                <p key={e} className="flex items-start gap-1 text-xs font-medium text-rose-600 dark:text-rose-300">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  {e}
                </p>
              ))}
              {!skipped &&
                row.warnings.map((w) => (
                  <p key={w} className="text-xs text-amber-700 dark:text-amber-300">
                    {w}
                  </p>
                ))}
              {!skipped && repeatOf !== null && (
                <p className="text-xs text-amber-700 dark:text-amber-300">Looks like a repeat of an earlier row — importing both would double them up.</p>
              )}
            </div>
          </div>
        </TableCell>

        <TableCell className="min-w-[130px]">
          <span className="tabular-nums">{row.phoneE164 ? formatUkPhoneDisplay(row.phoneE164) : row.phone || '—'}</span>
        </TableCell>

        <TableCell className="min-w-[180px]">
          <p>{row.address || '—'}</p>
          <p className="whitespace-nowrap text-xs text-muted-foreground">{row.postcode || '—'}</p>
        </TableCell>

        <TableCell className="min-w-[90px]">
          {row.service || <span className="text-muted-foreground">Regular visit</span>}
        </TableCell>

        <TableCell className="min-w-[70px] tabular-nums">
          {row.price != null ? formatGbp(row.price) : '—'}
        </TableCell>

        <TableCell className="min-w-[110px] whitespace-nowrap">
          {row.frequencyDays ? (
            <span title={row.rawFrequency ? `Written as “${row.rawFrequency}”` : 'From your default'}>{frequencyLabel(row.frequencyDays)}</span>
          ) : (
            '—'
          )}
        </TableCell>

        <TableCell className="min-w-[110px] whitespace-nowrap">
          {skipped ? (
            '—'
          ) : (
            <span className={cn(next.source !== 'sheet' && 'text-muted-foreground')}>
              {formatShortDate(next.date)}
              {next.source === 'from-last-visit' && <span className="block text-[11px]">from last visit</span>}
              {next.source === 'default' && <span className="block text-[11px]">your default</span>}
              {next.source === 'today' && <span className="block text-[11px]">no date — starts today</span>}
              {next.source === 'sheet' && next.date < today && <span className="block text-[11px] text-amber-700 dark:text-amber-300">overdue</span>}
            </span>
          )}
        </TableCell>

        <TableCell className="min-w-[80px] tabular-nums">
          {row.balanceOwed != null ? (
            <span className="font-medium text-amber-700 dark:text-amber-300">{formatGbp(row.balanceOwed)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        <TableCell className="min-w-[100px]">
          <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[row.status])}>{STATUS_LABEL[row.status]}</span>
        </TableCell>

        <TableCell className="w-px whitespace-nowrap pl-1 pr-2">
          {!skipped && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-pressed={editing}
              aria-label={editing ? 'Close' : 'Edit this row'}
              className={cn(
                'flex h-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted',
                editing ? 'gap-1 bg-muted px-2 text-xs font-medium text-foreground' : 'size-7'
              )}
            >
              {editing ? (
                <>
                  <X className="size-3.5" />
                  Close
                </>
              ) : (
                <Pencil className="size-3.5" />
              )}
            </button>
          )}
        </TableCell>
      </TableRow>

      {fixing && (
        <RowPanel className="bg-rose-500/[0.04] hover:bg-rose-500/[0.04]">
            <p className="pb-3 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">Fields to fix</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {bad('name') && (
                <Field label="Name">
                  <EditableCell value={row.name} label="Name" invalid onCommit={commit('name')} width="w-full" />
                </Field>
              )}
              {(bad('address') || bad('postcode')) && (
                <Field label="Address" className="sm:col-span-2">
                  <EditableCell value={row.address} label="Address" invalid={bad('address')} onCommit={commit('address')} width="w-full" />
                </Field>
              )}
              {(bad('address') || bad('postcode')) && (
                <Field label="Postcode">
                  <EditableCell value={row.postcode || row.rawPostcode} label="Postcode" invalid={bad('postcode')} onCommit={commit('postcode')} width="w-full" />
                </Field>
              )}
              {bad('price') && (
                <Field label="Price">
                  <EditableCell value={row.rawPrice || (row.price != null ? String(row.price) : '')} label="Price" invalid onCommit={commit('price')} width="w-full" inputMode="decimal" />
                </Field>
              )}
              {bad('frequency') && (
                <Field label="Every">
                  <EditableCell value={row.rawFrequency} label="Every… e.g. 4 weeks" invalid onCommit={commit('frequency')} width="w-full" />
                </Field>
              )}
              {bad('nextVisitDate') && (
                <Field label="Next visit">
                  <EditableCell value={row.rawNextVisitDate} label="Next visit e.g. 22/10/2026" invalid onCommit={commit('nextVisitDate')} width="w-full" />
                </Field>
              )}
              {bad('balanceOwed') && (
                <Field label="Owes">
                  <EditableCell value={row.rawBalance} label="Owes" invalid onCommit={commit('balanceOwed')} width="w-full" inputMode="decimal" />
                </Field>
              )}
            </div>
        </RowPanel>
      )}

      {editing && !skipped && (
        <RowPanel className="bg-sky-500/[0.04] hover:bg-sky-500/[0.04]">
            <div className="flex flex-wrap items-center gap-3 pb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Editing this customer</p>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-muted px-2 text-xs font-medium text-foreground hover:bg-muted/80"
              >
                <X className="size-3.5" />
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name">
                <EditableCell value={row.name} label="Name" invalid={bad('name')} onCommit={commit('name')} width="w-full" />
              </Field>
              <Field label="Phone">
                <EditableCell value={row.rawPhone} label="Phone" invalid={false} onCommit={commit('phone')} width="w-full" inputMode="tel" />
              </Field>
              <Field label="Email">
                <EditableCell value={row.email} label="Email" invalid={false} onCommit={commit('email')} width="w-full" inputMode="email" />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <EditableCell value={row.address} label="Address" invalid={bad('address')} onCommit={commit('address')} width="w-full" />
              </Field>
              <Field label="Postcode">
                <EditableCell value={row.postcode || row.rawPostcode} label="Postcode" invalid={bad('postcode')} onCommit={commit('postcode')} width="w-full" />
              </Field>
              <Field label="Service">
                <EditableCell value={row.service} label="Service" invalid={false} onCommit={commit('service')} width="w-full" />
              </Field>
              <Field label="Price">
                <EditableCell value={row.rawPrice || (row.price != null ? String(row.price) : '')} label="Price" invalid={bad('price')} onCommit={commit('price')} width="w-full" inputMode="decimal" />
              </Field>
              <Field label="Every">
                <EditableCell value={row.rawFrequency} label="Every… e.g. 4 weeks" invalid={bad('frequency')} onCommit={commit('frequency')} width="w-full" />
              </Field>
              <Field label="Next visit">
                <EditableCell value={row.rawNextVisitDate} label="Next visit e.g. 22/10/2026" invalid={bad('nextVisitDate')} onCommit={commit('nextVisitDate')} width="w-full" />
              </Field>
              <Field label="Owes">
                <EditableCell value={row.rawBalance} label="Owes" invalid={bad('balanceOwed')} onCommit={commit('balanceOwed')} width="w-full" inputMode="decimal" />
              </Field>
              <Field label="Status">
                <select
                  aria-label="Status"
                  value={row.status}
                  onChange={(e) => onEdit(row.rowIndex, 'status', e.target.value)}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="skip">Leave out</option>
                </select>
              </Field>
            </div>
        </RowPanel>
      )}

      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={10} className="whitespace-normal">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What we read</p>
            {sourceEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing was written in this row.</p>
            ) : (
              <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                {sourceEntries.map(([k, v]) => (
                  <div key={k} className="flex gap-1.5">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(row.accessNotes || row.notes) && (
              <p className="mt-2 text-sm text-muted-foreground">
                {row.accessNotes && <>Access: <span className="text-foreground">{row.accessNotes}</span>. </>}
                {row.notes && <>Notes: <span className="text-foreground">{row.notes}</span></>}
              </p>
            )}
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
});

export function CustomerReviewTable({
  rows,
  repeats,
  defaultStart,
  today,
  onEdit,
}: {
  rows: PreparedCustomerRow[];
  repeats: Map<number, number>;
  defaultStart: Ymd | null;
  today: Ymd;
  onEdit: (rowIndex: number, edits: CustomerRowEdits) => void;
}) {
  return (
    <div className="@container mb-24 overflow-x-auto rounded-xl border bg-card/60 pb-2">
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Every</TableHead>
            <TableHead>Next visit</TableHead>
            <TableHead>Owes</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <Row
              key={row.rowIndex}
              row={row}
              repeatOf={repeats.get(row.rowIndex) ?? null}
              defaultStart={defaultStart}
              today={today}
              onEdit={(rowIndex, field, value) => onEdit(rowIndex, { [field]: value })}
              onUnskip={(rowIndex) => onEdit(rowIndex, { status: 'active' })}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
