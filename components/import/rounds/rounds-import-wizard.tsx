'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MinusCircle,
  PoundSterling,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { IconChip, plural, TONE, type Tone, formatDayMonth } from '@/components/rounds/overview/shared';
import { ChooseSource } from '@/components/import/rounds/choose-source';
import { CustomerReviewTable } from '@/components/import/rounds/customer-review-table';
import { EMPTY_DEFAULTS, ImportDefaults, type ImportDefaultsState } from '@/components/import/rounds/import-defaults';
import { ImportDone } from '@/components/import/rounds/import-done';
import { ImportSteps } from '@/components/import/rounds/import-steps';
import { Tag } from '@/components/look';
import { StuckLink } from '@/components/import/rounds/stuck-link';
import { afterImport, type AfterImportResult } from '@/lib/actions/rounds/import-after';
import { checkImportFile } from '@/lib/actions/rounds/import-check';
import { importRoundsCustomers, type ImportRoundsResult } from '@/lib/actions/rounds/import';
import { sha256Hex } from '@/lib/import/file-hash';
import {
  CUSTOMER_EXTRACTION_BATCH_SIZE,
  blankExtractedCustomerRow,
  isImportableCustomerRow,
  parseMoneyAmount,
  prepareExtractedCustomerRow,
  summariseCustomerRows,
  type CustomerRowEdits,
  type ExtractedCustomerRow,
  type PreparedCustomerRow,
} from '@/lib/import/extracted-customer-row';
import { extractCustomerRowsBatch } from '@/lib/import/extract-customer-rows';
import { isSpreadsheetImportFile, parseSpreadsheetFile } from '@/lib/import/parse-spreadsheet-file';
import { readRoundBook } from '@/lib/import/read-round-book';
import { effectiveNextVisit, findRepeatRows, owedFromBefore } from '@/lib/import/review-helpers';
import { HEIC_FAILED, SHRINK_ABOVE_BYTES, MAX_PDF_BYTES, convertHeicToJpeg, shrinkPhoto } from '@/lib/expenses/receipt-file';
import { formatGbp } from '@/lib/money/pence';
import { todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';

/** Spreadsheet batches in flight at once (same as the jobs import). */
const EXTRACTION_CONCURRENCY = 4;
const PHOTO_CONCURRENCY = 2;
const PAGE_SIZE = 100;

const SHEET_UNREADABLE = "We couldn't open that file. Save it as CSV or Excel (.xlsx) and try again.";

type Step = 'choose' | 'reading' | 'review' | 'saving' | 'done' | 'failed';
type SavedImport = Extract<ImportRoundsResult, { success: true }>;
type AfterImport = Extract<AfterImportResult, { success: true }>;

/** A chosen start date becomes the row's next visit, so the save step uses the same date the review showed. */
function rowForImport(row: PreparedCustomerRow, defaultStart: Ymd | null, today: Ymd): PreparedCustomerRow {
  const next = effectiveNextVisit(row, defaultStart, today);
  if (next.source === 'default') return { ...row, nextVisitDate: next.date };
  return row;
}
type Source = 'spreadsheet' | 'round_book';
type Filter = 'all' | 'fix' | 'ready' | 'left';

function dateLabel(iso: string): string {
  return `${formatDayMonth(iso.slice(0, 10))} ${iso.slice(0, 4)}`;
}

function SummaryTile({
  tone,
  icon: Icon,
  label,
  value,
  children,
  onClick,
  active,
}: {
  tone: Tone;
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('rounded-xl text-left', onClick && 'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none')}
    >
      <Card
        className={cn(
          'glass-card h-full flex-row items-center gap-3 p-3 transition-all',
          TONE[tone].border,
          onClick && 'hover:-translate-y-0.5 hover:shadow-md',
          active && 'ring-2 ring-ring/40'
        )}
      >
        <IconChip icon={Icon} tone={tone} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{children}</span>
        </span>
        <span className={cn('shrink-0 text-xl font-semibold tracking-tight tabular-nums', TONE[tone].text)}>{value}</span>
      </Card>
    </Wrapper>
  );
}

export function RoundsImportWizard({ proImportHref }: { proImportHref?: string }) {
  const [step, setStep] = useState<Step>('choose');
  const [source, setSource] = useState<Source>('spreadsheet');
  const [fileName, setFileName] = useState('');
  const [extracted, setExtracted] = useState<ExtractedCustomerRow[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [edits, setEdits] = useState<Record<number, CustomerRowEdits>>({});
  const [defaults, setDefaults] = useState<ImportDefaultsState>(EMPTY_DEFAULTS);
  const [progress, setProgress] = useState({ label: '', done: 0, total: 0 });
  const [sameFileOn, setSameFileOn] = useState<string | null>(null);
  const [readNotice, setReadNotice] = useState<string | null>(null);
  const [failMessage, setFailMessage] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [leaveRest, setLeaveRest] = useState(true);
  const [fileSha256, setFileSha256] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedImport | null>(null);
  const [after, setAfter] = useState<AfterImport | null>(null);
  const cancelled = useRef(false);
  const importKey = useRef('');
  const importing = useRef(false);
  const today = useMemo(() => todayInLondon(), []);

  const frequencyDefault = Number(defaults.frequencyWeeks) > 0 ? Number(defaults.frequencyWeeks) * 7 : null;
  const priceDefault = parseMoneyAmount(defaults.price);

  const prepared = useMemo(
    () =>
      extracted.map((row) =>
        prepareExtractedCustomerRow(
          row,
          rawRows[row.row_index] ?? {},
          edits[row.row_index] ?? {},
          { frequencyDays: frequencyDefault, price: priceDefault },
          today
        )
      ),
    [extracted, rawRows, edits, frequencyDefault, priceDefault, today]
  );

  const counts = useMemo(() => summariseCustomerRows(prepared), [prepared]);
  const owed = useMemo(() => owedFromBefore(prepared), [prepared]);
  const repeats = useMemo(() => findRepeatRows(prepared), [prepared]);

  // Gaps the three fallbacks would fill — counted on the sheet's own values, not the defaults.
  const gaps = useMemo(() => {
    let frequency = 0;
    let price = 0;
    let start = 0;
    for (const row of prepared) {
      if (row.status === 'skip') continue;
      if (!row.rawFrequency) frequency += 1;
      if (!row.rawPrice) price += 1;
      if (!row.rawNextVisitDate && !row.lastVisitDate) start += 1;
    }
    return { frequency, price, start };
  }, [prepared]);

  const visible = useMemo(() => {
    return prepared.filter((row) => {
      if (filter === 'fix') return row.status !== 'skip' && !row.ok;
      if (filter === 'ready') return row.status !== 'skip' && row.ok;
      if (filter === 'left') return row.status === 'skip';
      return true;
    });
  }, [prepared, filter]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const importable = prepared.filter(isImportableCustomerRow).length;
  const canImport = importable > 0 && (counts.toFix === 0 || leaveRest);

  // Nothing is saved yet, so leaving mid-review loses the reading and edits: warn.
  useEffect(() => {
    if (step !== 'review') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [step]);

  const startOver = useCallback(() => {
    cancelled.current = true;
    setStep('choose');
    setExtracted([]);
    setRawRows([]);
    setEdits({});
    setDefaults(EMPTY_DEFAULTS);
    setSameFileOn(null);
    setReadNotice(null);
    setFilter('all');
    setPage(0);
    setLeaveRest(true);
    setFileSha256(null);
    setSaved(null);
    setAfter(null);
    importKey.current = '';
  }, []);

  const finishReading = useCallback((rows: ExtractedCustomerRow[], raw: Record<string, string>[], name: string, from: Source) => {
    setSource(from);
    setFileName(name);
    setExtracted(rows);
    setRawRows(raw);
    setFilter('all');
    setPage(0);
    importKey.current = crypto.randomUUID();
    setStep('review');
  }, []);

  // When the review opens, jump to the rows that need fixing if there are any.
  useEffect(() => {
    if (step === 'review' && counts.toFix > 0) setFilter('fix');
    // only when the review first opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const fail = useCallback((message: string) => {
    setFailMessage(message);
    setStep('failed');
  }, []);

  const readSpreadsheet = useCallback(
    async (file: File) => {
      if (!isSpreadsheetImportFile(file.name)) {
        fail(SHEET_UNREADABLE);
        return;
      }
      cancelled.current = false;
      setStep('reading');
      setReadNotice(null);
      setSameFileOn(null);
      setProgress({ label: 'Opening your file…', done: 0, total: 0 });

      let rows: Record<string, string>[];
      try {
        rows = await parseSpreadsheetFile(file);
      } catch {
        fail(SHEET_UNREADABLE);
        return;
      }

      const sha = await sha256Hex(file);
      setFileSha256(sha || null);
      if (sha) {
        void checkImportFile(sha).then((r) => {
          if (r.importedAt) setSameFileOn(r.importedAt);
        });
      }

      const batches: Array<{ rows: Record<string, string>[]; startIndex: number }> = [];
      for (let i = 0; i < rows.length; i += CUSTOMER_EXTRACTION_BATCH_SIZE) {
        batches.push({ rows: rows.slice(i, i + CUSTOMER_EXTRACTION_BATCH_SIZE), startIndex: i });
      }

      const collected: ExtractedCustomerRow[] = [];
      const failures: string[] = [];
      setProgress({ label: `Reading ${rows.length} rows…`, done: 0, total: rows.length });

      // A small pool, so the bar moves as each batch lands rather than a wave at a time.
      let nextBatch = 0;
      const worker = async () => {
        while (nextBatch < batches.length && !cancelled.current) {
          const batch = batches[nextBatch]!;
          nextBatch += 1;
          const result = await extractCustomerRowsBatch({ rows: batch.rows, startIndex: batch.startIndex, fileName: file.name });
          if (result.success) collected.push(...result.rows);
          else {
            failures.push(result.error);
            // A row we couldn't read stays visible and red, never silently dropped.
            for (let k = 0; k < batch.rows.length; k += 1) collected.push(blankExtractedCustomerRow(batch.startIndex + k));
          }
          setProgress((p) => ({ ...p, done: p.done + batch.rows.length }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(EXTRACTION_CONCURRENCY, batches.length) }, worker));
      if (cancelled.current) return;

      if (failures.length > 0) {
        toast.error(
          `${plural(failures.length, 'batch', 'batches')} couldn't be read — those rows are marked red so you can fill them in. ${failures[0]}`,
          { duration: 12000 }
        );
      }
      collected.sort((a, b) => a.row_index - b.row_index);
      finishReading(collected, rows, file.name, 'spreadsheet');
    },
    [fail, finishReading]
  );

  /** One chosen photo → something the server will take (HEIC converted, big ones shrunk). */
  const preparePhoto = useCallback(async (original: File): Promise<File | string> => {
    let file = original;
    const lower = original.name.toLowerCase();
    if (/image\/hei[cf]/.test(original.type) || /\.hei[cf]$/.test(lower)) {
      const converted = await convertHeicToJpeg(original);
      if (!converted) return HEIC_FAILED;
      file = converted;
    }
    if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
      return file.size > MAX_PDF_BYTES ? 'That PDF is too big (4 MB max).' : file;
    }
    return file.size > SHRINK_ABOVE_BYTES ? shrinkPhoto(file) : file;
  }, []);

  const readPhotos = useCallback(
    async (files: File[]) => {
      cancelled.current = false;
      setFileSha256(null);
      setStep('reading');
      setReadNotice(null);
      setSameFileOn(null);
      setProgress({ label: `Reading photo 1 of ${files.length}…`, done: 0, total: files.length });

      // One photo per request: a request body tops out near 5 MB.
      const results: Array<{ rows: ExtractedCustomerRow[]; raw: Record<string, string>[] } | null> = new Array(files.length).fill(null);
      const errors: string[] = [];
      let next = 0;
      let finished = 0;
      const worker = async () => {
        while (next < files.length && !cancelled.current) {
          const i = next;
          next += 1;
          const prepared = await preparePhoto(files[i]!);
          if (typeof prepared === 'string') {
            errors.push(prepared);
          } else {
            const fd = new FormData();
            fd.set('kind', 'photos');
            fd.append('file', prepared);
            const res = await readRoundBook(fd);
            if (res.success) results[i] = { rows: res.rows, raw: res.rawRows };
            else errors.push(res.error);
          }
          finished += 1;
          setProgress({ label: `Reading photo ${Math.min(finished + 1, files.length)} of ${files.length}…`, done: finished, total: files.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, files.length) }, worker));
      if (cancelled.current) return;

      const rows: ExtractedCustomerRow[] = [];
      const raw: Record<string, string>[] = [];
      let failedPhotos = 0;
      for (const result of results) {
        if (!result) {
          failedPhotos += 1;
          continue;
        }
        for (let k = 0; k < result.rows.length; k += 1) {
          rows.push({ ...result.rows[k]!, row_index: rows.length });
          raw.push(result.raw[k] ?? {});
        }
      }
      if (rows.length === 0) {
        fail(errors[0] ?? "We couldn't read any customers. Try clearer photos, or type them in.");
        return;
      }
      if (failedPhotos > 0) {
        setReadNotice(`We couldn't read ${plural(failedPhotos, 'photo', 'photos')} — add ${failedPhotos === 1 ? 'it' : 'them'} again or type those customers in.`);
      }
      finishReading(rows, raw, plural(files.length, 'photo', 'photos'), 'round_book');
    },
    [fail, finishReading, preparePhoto]
  );

  const readText = useCallback(
    async (text: string) => {
      cancelled.current = false;
      setFileSha256(null);
      setStep('reading');
      setReadNotice(null);
      setSameFileOn(null);
      setProgress({ label: 'Reading your list…', done: 0, total: 0 });
      const fd = new FormData();
      fd.set('kind', 'text');
      fd.set('text', text);
      const res = await readRoundBook(fd);
      if (cancelled.current) return;
      if (!res.success) {
        fail(res.error);
        return;
      }
      finishReading(res.rows, res.rawRows, 'Typed list', 'round_book');
    },
    [fail, finishReading]
  );

  const setEdit = useCallback((rowIndex: number, patch: CustomerRowEdits) => {
    setEdits((prev) => ({ ...prev, [rowIndex]: { ...(prev[rowIndex] ?? {}), ...patch } }));
  }, []);

  const runImport = useCallback(async () => {
    if (importing.current) return;
    const rows = prepared
      .filter(isImportableCustomerRow)
      .map((row) => rowForImport(row, defaults.startDate || null, today));
    if (rows.length === 0) return;
    if (!importKey.current) importKey.current = crypto.randomUUID();
    importing.current = true;
    setStep('saving');
    setProgress({ label: `Saving ${plural(rows.length, 'customer', 'customers')}…`, done: 0, total: 0 });
    try {
      const result = await importRoundsCustomers({
        importKey: importKey.current,
        rows,
        fileName: fileName || 'import',
        fileSha256,
        source,
      });
      if (!result.success) {
        toast.error(result.error);
        if (result.error !== 'This import is already running or done.') {
          importKey.current = crypto.randomUUID();
        }
        setStep('review');
        return;
      }
      let checked: AfterImport = { success: true, directDebit: null, directDebitCheckFailed: true };
      try {
        const dd = await afterImport({ importId: result.importId });
        if (dd.success) checked = dd;
      } catch {
        checked = { success: true, directDebit: null, directDebitCheckFailed: true };
      }
      setAfter(checked);
      setSaved(result);
      setStep('done');
    } catch {
      importKey.current = crypto.randomUUID();
      toast.error("The import didn't finish. Press Import again — customers already saved will be skipped.");
      setStep('review');
    } finally {
      importing.current = false;
    }
  }, [prepared, defaults.startDate, today, fileName, fileSha256, source]);

  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <div className="space-y-5">
      <ImportSteps current={step === 'done' ? 3 : step === 'review' || step === 'saving' ? 2 : 1} />
      {proImportHref ? (
        <p className="text-sm text-muted-foreground">
          Importing jobs instead?{' '}
          <a href={proImportHref} className="font-medium text-sky-600 hover:underline dark:text-sky-300">
            Use the job import
          </a>
        </p>
      ) : null}

      {step === 'choose' && (
        <ChooseSource onSpreadsheet={(f) => void readSpreadsheet(f)} onPhotos={(f) => void readPhotos(f)} onText={(t) => void readText(t)} />
      )}

      {step === 'reading' && (
        <Card className="glass-card items-center gap-4 p-8 text-center">
          <Loader2 className="size-8 animate-spin text-sky-500" aria-hidden="true" />
          <div>
            <p className="text-base font-semibold">{progress.label}</p>
            <p className="text-sm text-muted-foreground">Nothing is saved yet — you check everything first.</p>
          </div>
          {progress.total > 0 && (
            <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all duration-300" style={{ width: `${percent}%` }} />
            </div>
          )}
          <Button variant="outline" size="sm" onClick={startOver}>
            Cancel
          </Button>
        </Card>
      )}

      {step === 'failed' && (
        <Card className="glass-card gap-4 border-rose-500/30 p-6">
          <div className="flex items-start gap-3">
            <IconChip icon={AlertTriangle} tone="rose" />
            <div>
              <p className="text-base font-semibold">That didn&apos;t work</p>
              <p className="mt-1 text-sm text-muted-foreground">{failMessage}</p>
            </div>
          </div>
          <div>
            <Button variant="outline" onClick={startOver} className="gap-2">
              <ArrowLeft className="size-4" /> Try again
            </Button>
          </div>
          <StuckLink context="read_failed" />
        </Card>
      )}

      {step === 'review' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                {plural(counts.ready + counts.toFix, 'customer', 'customers')} found
                {counts.toFix > 0 ? <Tag tone="amber">{counts.toFix} need a look</Tag> : <Tag tone="emerald">All ready</Tag>}
              </h2>
              <p className="text-sm text-muted-foreground">
                {source === 'spreadsheet' ? 'Spreadsheet' : 'Round book'}: {fileName} · {plural(prepared.length, 'row', 'rows')}. Fix anything in red, then press Import.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                if (Object.keys(edits).length === 0 || window.confirm('Start again? Your changes on this screen will be lost.')) startOver();
              }}
            >
              <ArrowLeft className="size-4" /> Start again
            </Button>
          </div>

          {sameFileOn && (
            <Card className="gap-1 border-amber-500/40 bg-amber-500/10 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
                <AlertTriangle className="size-4" aria-hidden="true" />
                You imported this file on {dateLabel(sameFileOn)}.
              </p>
              <p className="text-sm text-amber-800/90 dark:text-amber-200/90">
                Importing again may create duplicates — we&apos;ll skip customers who are already here.
              </p>
            </Card>
          )}
          {readNotice && (
            <Card className="gap-1 border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{readNotice}</p>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
            <SummaryTile tone="emerald" icon={CheckCircle2} label="Ready to import" value={String(counts.ready)} onClick={() => { setFilter('ready'); setPage(0); }} active={filter === 'ready'}>
              {counts.ready === 1 ? 'customer is' : 'customers are'} good to go
            </SummaryTile>
            <SummaryTile
              tone={counts.toFix > 0 ? 'rose' : 'teal'}
              icon={counts.toFix > 0 ? AlertTriangle : CheckCircle2}
              label="Need fixing"
              value={String(counts.toFix)}
              onClick={() => { setFilter('fix'); setPage(0); }}
              active={filter === 'fix'}
            >
              {counts.toFix > 0 ? 'in red below — type the answer in the cell' : 'Nothing to fix'}
            </SummaryTile>
            <SummaryTile tone="indigo" icon={MinusCircle} label="Left out" value={String(counts.skipped)} onClick={() => { setFilter('left'); setPage(0); }} active={filter === 'left'}>
              {counts.skipped > 0 ? 'cancelled, or not a customer' : 'Nobody is being left out'}
            </SummaryTile>
            <SummaryTile tone="amber" icon={PoundSterling} label="Owed from before" value={formatGbp(owed.total)}>
              {owed.customers > 0 ? `across ${plural(owed.customers, 'customer', 'customers')}, added when you import` : 'Nobody owes anything from before'}
            </SummaryTile>
          </div>

          <ImportDefaults
            value={defaults}
            onChange={setDefaults}
            missingFrequency={gaps.frequency}
            missingPrice={gaps.price}
            missingStart={gaps.start}
          />

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show rows">
            {(
              [
                ['all', 'All', prepared.length],
                ['fix', 'To fix', counts.toFix],
                ['ready', 'Ready', counts.ready],
                ['left', 'Left out', counts.skipped],
              ] as const
            ).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFilter(key);
                  setPage(0);
                }}
                aria-pressed={filter === key}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                  filter === key ? 'border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {label} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <Card className="glass-card items-center p-8 text-center text-sm text-muted-foreground">
              {filter === 'fix' ? 'Nothing left to fix — every row is ready.' : 'No rows to show here.'}
            </Card>
          ) : (
            <CustomerReviewTable rows={pageRows} repeats={repeats} defaultStart={defaults.startDate || null} today={today} onEdit={setEdit} />
          )}

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="tabular-nums text-muted-foreground">
                Rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visible.length)} of {visible.length}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}

          <div className="sticky bottom-3 z-10">
            <Card className="flex-row flex-wrap items-center justify-between gap-3 border-border/80 bg-card/95 p-3 shadow-lg backdrop-blur-md sm:p-4">
              <div className="min-w-0 space-y-1">
                {counts.toFix > 0 ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={leaveRest} onCheckedChange={setLeaveRest} aria-label="Import the ready rows and leave the rest" />
                    Import the ready rows and leave the {counts.toFix} to fix
                  </label>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-4" aria-hidden="true" /> Everything is ready.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Nothing is saved until you press Import.</p>
              </div>
              <Button size="lg" disabled={!canImport} onClick={() => void runImport()}>
                Import {importable} {importable === 1 ? 'customer' : 'customers'}
              </Button>
            </Card>
          </div>

          <StuckLink context="review" />
        </>
      )}

      {step === 'saving' && (
        <Card className="glass-card items-center gap-4 p-8 text-center">
          <Loader2 className="size-8 animate-spin text-sky-500" aria-hidden="true" />
          <div>
            <p className="text-base font-semibold">{progress.label}</p>
            <p className="text-sm text-muted-foreground">Adding customers, visits and anything they owed. Stay on this page.</p>
          </div>
        </Card>
      )}

      {step === 'done' && saved && (
        <ImportDone
          result={saved}
          rows={prepared}
          directDebit={after?.directDebit ?? null}
          directDebitCheckFailed={after?.directDebitCheckFailed ?? false}
        />
      )}

    </div>
  );
}
