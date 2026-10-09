'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Download, Loader2, Trash2, Upload, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BatchConfirmDialog } from '@/components/workers/batch-confirm-dialog';
import { addBulkWorkersChunk, checkBulkWorkers, finishBulkAdd, type BulkCheckResult } from '@/lib/actions/workers-bulk';
import { noticeForBatch, type Allowance, type BatchNotice } from '@/lib/billing/pro-allowance';
import { PRO_PLANS, formatPoundsLong } from '@/lib/billing/pro-plans';
import { applyChunk, emptyProgress, summaryLine, type BulkProgress } from '@/lib/workers/bulk-summary';
import {
  BULK_CHUNK_SIZE,
  BULK_MAX_ROWS,
  parseBulkWorkers,
  validateBulkRows,
  type BulkRow,
} from '@/lib/workers/bulk-parse';
import { cn } from '@/lib/utils';

type WorkerType = 'company_subcontractor' | 'employee';
type Phase = 'edit' | 'adding' | 'done';
type Field = 'name' | 'phone' | 'postcode' | 'email';

const TEMPLATE = 'Name,Phone,Postcode,Email\nDave Mercer,07700 900123,M3 2ER,dave@example.com\nPriya Shah,07700 900124,SW1A 1AA,\n';
const EXAMPLE = 'Name\tPhone\tPostcode\tEmail\nDave Mercer\t07700 900123\tM3 2ER\tdave@example.com\nPriya Shah\t07700 900124\tSW1A 1AA\t';

const TYPE_HELP: Record<WorkerType, string> = {
  company_subcontractor:
    'Self-employed. They set up their own account with their business name and see only the jobs you give them.',
  employee: 'Works only for you. They sign in to see their jobs; no business account.',
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The live cost line, before the server has checked anything. */
function liveCostLine(allowance: Allowance | null, validCount: number): { tone: 'over' | 'fits'; text: string } | null {
  if (!allowance || !allowance.limited || validCount === 0) return null;
  const notice = noticeForBatch(allowance, validCount);
  // Includes the extras already paid for at sign-up: those count as part of the plan, so nothing new to say.
  if (!notice) return { tone: 'fits', text: 'Fits inside your plan: no extra cost.' };
  const yearly = allowance.interval === 'year';
  const unit = PRO_PLANS[allowance.tier].extraPence[yearly ? 'year' : 'month'];
  const cost = notice.newExtras * unit;
  return {
    tone: 'over',
    text: `Adding ${validCount} will put you ${notice.extrasAfter === notice.newExtras ? '' : `${notice.newExtras} more `}over your ${notice.included}: ${
      yearly ? `+${formatPoundsLong(cost)} a year, charged for the months left` : `+${formatPoundsLong(cost)} a month`
    }.`.replace('will put you  over', 'will put you over'),
  };
}

export function BulkAddWorkers({ allowance }: { allowance: Allowance | null }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [unknownHeaders, setUnknownHeaders] = useState<string[]>([]);
  const [workerType, setWorkerType] = useState<WorkerType>('company_subcontractor');
  const [hideGood, setHideGood] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<number, string[]>>({});

  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    notice: BatchNotice;
    interval: 'month' | 'year' | null;
    chargeNowPence: number | null;
    send: BulkRow[];
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [phase, setPhase] = useState<Phase>('edit');
  const [progress, setProgress] = useState<BulkProgress>(emptyProgress(0));
  const [runError, setRunError] = useState<string | null>(null);
  const [emailFailed, setEmailFailed] = useState(0);
  const busy = useRef(false);

  const withErrors = rows.map((r) => ({ ...r, all: [...r.errors, ...(serverErrors[r.line] ?? [])] }));
  const goodRows = withErrors.filter((r) => r.all.length === 0 && r.clean);
  const problemCount = withErrors.length - goodRows.length;
  const cost = liveCostLine(allowance, goodRows.length);

  const loadText = useCallback((value: string) => {
    setText(value);
    const parsed = parseBulkWorkers(value);
    setRows(validateBulkRows(parsed.rows));
    setTruncated(parsed.truncated);
    setUnknownHeaders(parsed.unknownHeaders);
    setServerErrors({});
    setCheckError(null);
  }, []);

  // Warn before leaving mid-run (workers already added stay).
  useEffect(() => {
    if (phase !== 'adding') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  function updateCell(line: number, field: Field, value: string) {
    setRows((current) => validateBulkRows(current.map((r) => (r.line === line ? { ...r, [field]: value } : r))));
    setServerErrors((current) => {
      if (!current[line]) return current;
      const next = { ...current };
      delete next[line];
      return next;
    });
  }

  function removeRow(line: number) {
    setRows((current) => validateBulkRows(current.filter((r) => r.line !== line)));
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadText(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workwise-team-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function run(send: BulkRow[], confirmedTeamSize: number) {
    if (busy.current) return;
    busy.current = true;
    setPhase('adding');
    setRunError(null);
    let current = emptyProgress(send.length);
    setProgress(current);
    const workerIds: string[] = [];
    try {
      for (let i = 0; i < send.length; i += BULK_CHUNK_SIZE) {
        const chunk = send.slice(i, i + BULK_CHUNK_SIZE);
        const result = await addBulkWorkersChunk({
          rows: chunk.map((r) => ({ line: r.line, name: r.name, phone: r.phone, postcode: r.postcode, email: r.email })),
          workerType,
          confirmedTeamSize,
        });
        if (!result.ok) {
          setRunError(result.error);
          break;
        }
        for (const r of result.results) if (r.workerId) workerIds.push(r.workerId);
        current = applyChunk(current, result.results);
        setProgress(current);
      }
      if (workerIds.length > 0) {
        const finished = await finishBulkAdd({ workerIds, confirmedTeamSize });
        setEmailFailed(finished.emailFailed.length);
        if (!finished.ok && finished.error) setRunError(finished.error);
      }
    } catch {
      setRunError("Something went wrong. Workers already added are on your team; check the Workers page.");
    } finally {
      busy.current = false;
      setPhase('done');
      router.refresh();
    }
  }

  async function start() {
    if (checking || busy.current || goodRows.length === 0) return;
    setChecking(true);
    setCheckError(null);
    try {
      const send = goodRows;
      const result: BulkCheckResult = await checkBulkWorkers({
        rows: send.map((r) => ({ name: r.name, phone: r.phone, postcode: r.postcode, email: r.email })),
        workerType,
      });
      if (!result.ok) {
        setCheckError(result.error);
        return;
      }
      // The server's verdict, mapped back by position to our rows.
      const errors: Record<number, string[]> = {};
      const accepted: BulkRow[] = [];
      result.rows.forEach((verdict, i) => {
        const row = send[i];
        if (verdict.errors.length > 0) errors[row.line] = verdict.errors;
        else accepted.push(row);
      });
      setServerErrors(errors);
      if (accepted.length === 0) {
        setCheckError('None of these could be added. Fix the rows marked in the table.');
        return;
      }
      if (accepted.length < send.length) {
        setCheckError(`${plural(send.length - accepted.length, 'worker needs', 'workers need')} fixing before you can add the rest.`);
        return;
      }
      if (result.notice) {
        setConfirm({ notice: result.notice, interval: result.interval, chargeNowPence: result.chargeNowPence, send: accepted });
      } else {
        await run(accepted, (allowance?.used ?? 0) + accepted.length);
      }
    } catch {
      setCheckError("We couldn't check your list. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  async function confirmAdd() {
    if (!confirm || confirming) return;
    setConfirming(true);
    const { send, notice } = confirm;
    setConfirm(null);
    try {
      await run(send, notice.teamAfter);
    } finally {
      setConfirming(false);
    }
  }

  function tryFailedAgain() {
    const failedLines = new Set(progress.failed.map((f) => f.line));
    const again = rows.filter((r) => failedLines.has(r.line));
    setRows(validateBulkRows(again.map((r, i) => ({ ...r, line: i + 1 }))));
    setServerErrors({});
    setProgress(emptyProgress(0));
    setPhase('edit');
  }

  if (phase !== 'edit') {
    const added = progress.invited + progress.addedNoInvite;
    const pct = progress.total === 0 ? 100 : Math.round((progress.done / progress.total) * 100);
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-(--look-card-shadow)" aria-live="polite">
          {phase === 'adding' ? (
            <>
              <h2 className="text-base font-semibold">
                Adding {progress.done} of {progress.total}…
              </h2>
              <div
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
              >
                <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Please keep this page open until it finishes.</p>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {added > 0 ? <CheckCircle2 className="size-5" aria-hidden /> : <AlertTriangle className="size-5" aria-hidden />}
                </span>
                <div>
                  <h2 className="text-base font-semibold">{added > 0 ? 'Your team is on WorkWise' : 'Nothing was added'}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">{summaryLine(progress)}</p>
                </div>
              </div>
              {runError ? (
                <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {runError}
                </p>
              ) : null}
              {emailFailed > 0 ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  {plural(emailFailed, 'invitation email', 'invitation emails')} didn&apos;t send. You can resend {emailFailed === 1 ? 'it' : 'them'}{' '}
                  from the Invited tab.
                </p>
              ) : null}
              {progress.failed.length > 0 ? (
                <ul className="mt-4 divide-y divide-border rounded-xl border border-border text-sm">
                  {progress.failed.map((f) => {
                    const row = rows.find((r) => r.line === f.line);
                    return (
                      <li key={f.line} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                        <span className="font-medium">{row?.name || `Row ${f.line}`}</span>
                        <span className="text-destructive">{f.error ?? "Couldn't be added"}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild variant="gradient">
                  <Link href="/workers">Go to your team</Link>
                </Button>
                {emailFailed > 0 ? (
                  <Button asChild variant="outline">
                    <Link href="/workers?tab=invited">Open Invited workers</Link>
                  </Button>
                ) : null}
                {progress.failed.length > 0 ? (
                  <Button type="button" variant="outline" onClick={tryFailedAgain}>
                    Try these again
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  const shownRows = hideGood ? withErrors.filter((r) => r.all.length > 0) : withErrors;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {allowance && allowance.limited ? (
        <p className="text-sm text-muted-foreground">
          Your {allowance.tierName} plan includes {allowance.included} workers. You have {allowance.used}.
        </p>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5" aria-labelledby="bulk-list-heading">
        <h2 id="bulk-list-heading" className="text-[15px] font-semibold">
          Your list
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Copy the rows from your spreadsheet and paste them here. Columns: name, phone, postcode, email.
        </p>
        <Textarea
          value={text}
          onChange={(e) => loadText(e.target.value)}
          placeholder={EXAMPLE}
          rows={6}
          className="mt-3 max-h-64 overflow-auto font-mono text-[13px]"
          aria-label="Paste your workers here"
          spellCheck={false}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button asChild type="button" variant="outline" size="sm" className="cursor-pointer">
            <label>
              <Upload className="size-4" aria-hidden />
              Upload a CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
            <Download className="size-4" aria-hidden />
            Download a template
          </Button>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">These are</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(['company_subcontractor', 'employee'] as const).map((t) => (
              <label
                key={t}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  workerType === t ? 'border-primary bg-primary/[0.04]' : 'border-border hover:bg-muted/40',
                )}
              >
                <input type="radio" name="bulk_worker_type" checked={workerType === t} onChange={() => setWorkerType(t)} className="mt-1" />
                <span>
                  <span className="block font-medium">{t === 'employee' ? 'Employees' : 'Subcontractors'}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{TYPE_HELP[t]}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">Every worker needs an email: the invite we send to it is how they get their login.</p>
        </fieldset>
      </section>

      {rows.length > 0 ? (
        <section className="@container rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5" aria-labelledby="bulk-check-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="bulk-check-heading" role="alert" className="text-[15px] font-semibold">
              {goodRows.length} ready{problemCount > 0 ? ` · ${problemCount} need fixing` : ''}
            </h2>
            {problemCount > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={hideGood} onChange={(e) => setHideGood(e.target.checked)} />
                Hide rows that are fine
              </label>
            ) : null}
          </div>
          {truncated ? (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
              Only the first {BULK_MAX_ROWS} are used. Add the rest in a second go.
            </p>
          ) : null}
          {unknownHeaders.length > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Ignored columns: {unknownHeaders.join(', ')}.</p>
          ) : null}

          <div className="mt-3 hidden grid-cols-[1.3fr_1fr_0.8fr_1.4fr_2.25rem] gap-2 px-1 text-xs font-medium text-muted-foreground @2xl:grid">
            <span>Name</span>
            <span>Phone</span>
            <span>Postcode</span>
            <span>Email</span>
            <span />
          </div>
          <ul className="mt-1 space-y-2">
            {shownRows.map((r) => (
              <li key={r.line} className={cn('rounded-xl border p-2', r.all.length > 0 ? 'border-destructive/40 bg-destructive/[0.04]' : 'border-border')}>
                <div className="grid grid-cols-[1.3fr_1fr_2.25rem] gap-2 @2xl:grid-cols-[1.3fr_1fr_0.8fr_1.4fr_2.25rem]">
                  {(['name', 'phone', 'postcode', 'email'] as const).map((field) => (
                    <Input
                      key={field}
                      value={r[field]}
                      onChange={(e) => updateCell(r.line, field, e.target.value)}
                      aria-label={`${field === 'postcode' ? 'Postcode' : field[0].toUpperCase() + field.slice(1)}, row ${r.line}`}
                      placeholder={field === 'email' ? 'Email' : field[0].toUpperCase() + field.slice(1)}
                      inputMode={field === 'phone' ? 'tel' : field === 'email' ? 'email' : undefined}
                      className={cn('h-9 text-sm', field === 'name' && 'col-span-2 @2xl:col-span-1', field === 'email' && 'col-span-3 @2xl:col-span-1')}
                    />
                  ))}
                  <Button type="button" variant="ghost" size="icon" className="col-start-3 row-start-1 size-9 @2xl:col-start-auto @2xl:row-start-auto" aria-label={`Remove row ${r.line}`} onClick={() => removeRow(r.line)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                {r.all.length > 0 ? <p className="mt-1.5 px-1 text-[13px] text-destructive">{r.all.join(' · ')}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cost ? (
        <p
          className={cn(
            'rounded-xl px-4 py-3 text-sm font-medium',
            cost.tone === 'over'
              ? 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
              : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200',
          )}
        >
          {cost.text}
        </p>
      ) : null}

      {checkError ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {checkError}
        </p>
      ) : null}

      <div className="sticky bottom-3 z-10 flex justify-end">
        <Button
          type="button"
          variant="gradient"
          size="lg"
          className="w-full gap-2 shadow-lg sm:w-auto"
          disabled={goodRows.length === 0 || checking}
          onClick={() => void start()}
        >
          {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Users className="size-4" aria-hidden />}
          {checking ? 'Checking…' : `Check and add ${plural(goodRows.length, 'worker', 'workers')}`}
        </Button>
      </div>

      <BatchConfirmDialog
        notice={confirm?.notice ?? null}
        interval={confirm?.interval ?? null}
        chargeNowPence={confirm?.chargeNowPence ?? null}
        pending={confirming}
        onConfirm={() => void confirmAdd()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
