'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import {
  Upload,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Plus,
  X,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn } from '@/lib/utils';
import { importJobs, type ImportAllocationFailure } from '@/lib/actions/import';
import { createCustomerForImport } from '@/lib/actions/customers';
import { spreadsheetCellToImportString } from '@/lib/import/parse-scheduled-date';
import { normalizeHeaders, normalizeRowKeys } from '@/lib/import/normalize-import-headers';
import {
  EXTRACTION_BATCH_SIZE,
  prepareExtractedRow,
  type EditableRowField,
  type ExtractedJobRow,
  type RowEdits,
} from '@/lib/import/extracted-job-row';
import { extractJobRowsBatch } from '@/lib/import/extract-job-rows';
import type { CustomerImportOption } from '@/lib/data/customers';
import { SourceFieldsPeek, SourceFieldsPeekProvider } from '@/components/import/source-fields-peek';

/** Extraction batches sent to the AI at once. */
const EXTRACTION_CONCURRENCY = 4;

function isSpreadsheetImportFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.csv') || lower.endsWith('.xlsx');
}

function xlsxWorkbookToRowRecords(wb: XLSX.WorkBook): Record<string, string>[] {
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  // raw + cellDates: date cells become Date/serial, not locale strings like "9/1/2026".
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw: true,
  });
  return json
    .map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = spreadsheetCellToImportString(v);
      }
      return out;
    })
    .filter((row) => Object.values(row).some((v) => v.trim() !== ''));
}

type ImportResultState = {
  ok: boolean;
  count: number;
  assignedCount: number;
  unassignedCount: number;
  errors: string[];
  autoAllocate: boolean;
  allocationFailures: ImportAllocationFailure[];
  /** Hard failure message when ok is false. */
  errorMessage?: string;
};

/** Inline-editable cell shown on failed preview rows. */
function EditableCell({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="h-8 min-w-[120px] text-sm"
    />
  );
}

interface ImportWizardProps {
  tenantId: string;
  customers: CustomerImportOption[];
}

export function ImportWizard({ customers: initialCustomers }: ImportWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 'done'>(1);
  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [extractedRows, setExtractedRows] = useState<ExtractedJobRow[]>([]);
  const [rowEdits, setRowEdits] = useState<Record<number, RowEdits>>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedCount, setExtractedCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [autoAllocate, setAutoAllocate] = useState(true);
  /** When false (default), any invalid row blocks the whole import. */
  const [allowPartialImport, setAllowPartialImport] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultState | null>(null);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  /**
   * Same validation the server re-runs at import time, so the green/red you see
   * here is exactly what decides whether a row is written.
   */
  const preparedRows = useMemo(
    () =>
      extractedRows.map((extracted) =>
        prepareExtractedRow(
          extracted,
          csvData[extracted.row_index] ?? {},
          rowEdits[extracted.row_index] ?? {}
        )
      ),
    [extractedRows, csvData, rowEdits]
  );

  const rowStats = useMemo(() => {
    const readyCount = preparedRows.filter((r) => r.ok).length;
    return {
      readyCount,
      invalidCount: preparedRows.length - readyCount,
      hasInvalidRows: readyCount < preparedRows.length,
    };
  }, [preparedRows]);

  const setRowEdit = useCallback(
    (rowIndex: number, field: EditableRowField, value: string) => {
      setRowEdits((prev) => ({
        ...prev,
        [rowIndex]: { ...(prev[rowIndex] ?? {}), [field]: value },
      }));
    },
    []
  );

  /**
   * Extract every row through AI, a batch at a time and several batches in
   * flight, updating progress as each lands.
   */
  const runExtraction = useCallback(async (rows: Record<string, string>[]) => {
    setIsExtracting(true);
    setExtractedCount(0);
    setExtractedRows([]);
    setRowEdits({});
    setStep(3);

    const batches: Array<{ rows: Record<string, string>[]; startIndex: number }> = [];
    for (let i = 0; i < rows.length; i += EXTRACTION_BATCH_SIZE) {
      batches.push({ rows: rows.slice(i, i + EXTRACTION_BATCH_SIZE), startIndex: i });
    }

    const collected: ExtractedJobRow[] = [];
    const failures: string[] = [];

    try {
      for (let i = 0; i < batches.length; i += EXTRACTION_CONCURRENCY) {
        const inFlight = batches.slice(i, i + EXTRACTION_CONCURRENCY);
        const results = await Promise.all(
          inFlight.map((batch) =>
            extractJobRowsBatch({ rows: batch.rows, startIndex: batch.startIndex })
          )
        );
        results.forEach((result, j) => {
          const batch = inFlight[j]!;
          if (result.success) {
            collected.push(...result.rows);
          } else {
            failures.push(result.error);
          }
          setExtractedCount((n) => n + batch.rows.length);
        });
        // Show rows as they land rather than only at the end.
        setExtractedRows([...collected].sort((a, b) => a.row_index - b.row_index));
      }

      if (failures.length > 0) {
        toast.error(
          `${failures.length} batch${failures.length === 1 ? '' : 'es'} could not be read: ${failures[0]}`,
          { duration: 12000 }
        );
      } else {
        toast.success(`Read ${collected.length} row${collected.length === 1 ? '' : 's'}`, {
          duration: 5000,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the spreadsheet.', {
        duration: 12000,
      });
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      if (!isSpreadsheetImportFile(file.name)) {
        toast.error('Please upload a .csv or .xlsx file.', { duration: 8000 });
        return;
      }
      setCsvFile(file);

      const applyParsedRows = (rows: Record<string, string>[]) => {
        if (!rows.length) {
          toast.error('File has no data rows.', { duration: 8000 });
          setCsvData([]);
          return;
        }
        const headers = normalizeHeaders(Object.keys(rows[0]!));
        if (!headers.length) {
          toast.error('File has no usable column headers.', { duration: 8000 });
          return;
        }
        const normalizedRows = rows.map((row) => normalizeRowKeys(row, headers));
        setCsvData(normalizedRows);
        setAllowPartialImport(false);
        void runExtraction(normalizedRows);
      };

      const lower = file.name.toLowerCase();
      if (lower.endsWith('.xlsx')) {
        void (async () => {
          try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array', cellDates: true });
            applyParsedRows(xlsxWorkbookToRowRecords(wb));
          } catch {
            toast.error('Invalid Excel file.', { duration: 8000 });
          }
        })();
        return;
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          applyParsedRows(results.data as Record<string, string>[]);
        },
        error: () => toast.error('Invalid CSV format.', { duration: 8000 }),
      });
    },
    [runExtraction]
  );

  const handleCreateCustomer = async () => {
    setCreatingCustomer(true);
    try {
      const result = await createCustomerForImport(newCustomerName);
      if (!result.success || !result.id) {
        toast.error(result.error ?? 'Could not create customer', { duration: 10000 });
        return;
      }
      const option: CustomerImportOption = {
        id: result.id,
        name: result.name ?? newCustomerName.trim(),
        import_column_mapping: null,
        import_value_transforms: {},
        import_expected_headers: [],
      };
      setCustomers((prev) => [...prev, option].sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(result.id);
      setShowCreateCustomer(false);
      setNewCustomerName('');
      toast.success(`Created ${option.name}`, { duration: 6000 });
    } finally {
      setCreatingCustomer(false);
    }
  };

  const handleImport = async () => {
    if (!customerId || !extractedRows.length) {
      toast.error('Select a customer and upload a file first.', { duration: 8000 });
      return;
    }
    if (isExtracting) {
      toast.error('Still reading the spreadsheet — wait a moment.', { duration: 8000 });
      return;
    }
    setIsImporting(true);
    try {
      const result = await importJobs({
        customerId,
        extractedRows,
        csvData,
        rowEdits,
        fileName: csvFile?.name ?? 'import.csv',
        autoAllocate,
        allowPartialImport,
      });

      setImportResult(
        result.success
          ? {
              ok: true,
              count: result.count,
              assignedCount: result.assignedCount,
              unassignedCount: result.unassignedCount,
              errors: result.errors ?? [],
              autoAllocate,
              allocationFailures: result.allocationFailures ?? [],
            }
          : {
              ok: false,
              count: 0,
              assignedCount: 0,
              unassignedCount: 0,
              errors: result.errors ?? [],
              autoAllocate,
              allocationFailures: [],
              errorMessage: result.error,
            }
      );
      setStep('done');
    } catch (e) {
      setImportResult({
        ok: false,
        count: 0,
        assignedCount: 0,
        unassignedCount: 0,
        errors: [],
        autoAllocate,
        allocationFailures: [],
        errorMessage: e instanceof Error ? e.message : 'Import failed',
      });
      setStep('done');
    } finally {
      setIsImporting(false);
    }
  };

  const resetWizard = () => {
    setStep(1);
    setCsvFile(null);
    setCsvData([]);
    setExtractedRows([]);
    setRowEdits({});
    setExtractedCount(0);
    setIsExtracting(false);
    setImportResult(null);
    setAllowPartialImport(false);
  };

  const dismissImportResult = () => {
    setImportResult(null);
    setStep(3);
  };

  const stepLabel =
    step === 1 ? 'Customer' : step === 2 ? 'Upload' : step === 3 ? 'Review' : 'Done';

  const extractionPercent =
    csvData.length > 0 ? Math.round((extractedCount / csvData.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-6 shadow-[var(--shadow-glass-value)]">
        <div className="mb-2 flex items-center justify-between text-sm font-medium text-muted-foreground">
          <span>{typeof step === 'number' ? `Step ${step} of 3` : stepLabel}</span>
          <span>{stepLabel}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary transition-all duration-500"
            style={{
              width: `${step === 1 ? 33 : step === 2 ? 66 : 100}%`,
            }}
          />
        </div>
      </div>

      {step === 1 && (
        <Card className="glass-card rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5" />
              Who is this spreadsheet for?
            </CardTitle>
            <CardDescription>Pick the customer these jobs belong to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Customer</Label>
              <SearchableSelect
                value={customerId ?? ''}
                onValueChange={(v) => setCustomerId(v || null)}
                onOpenChange={(open) => {
                  if (open) setShowCreateCustomer(false);
                }}
                placeholder="Select customer…"
                searchPlaceholder="Search customers…"
                className="max-w-md"
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
            {!showCreateCustomer ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setShowCreateCustomer(true)}
              >
                <Plus className="size-4" />
                Create new customer
              </Button>
            ) : (
              <div className="relative flex max-w-md flex-col gap-2 rounded-lg border p-3 pt-8 sm:flex-row sm:items-end">
                <button
                  type="button"
                  aria-label="Close create customer"
                  className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    setShowCreateCustomer(false);
                    setNewCustomerName('');
                  }}
                >
                  <X className="size-4" />
                </button>
                <div className="flex-1 space-y-1">
                  <Label>New customer name</Label>
                  <Input
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Customer name"
                  />
                </div>
                <Button
                  type="button"
                  disabled={creatingCustomer || newCustomerName.trim().length < 2}
                  onClick={() => void handleCreateCustomer()}
                >
                  {creatingCustomer ? <Loader2 className="size-4 animate-spin" /> : 'Create'}
                </Button>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button disabled={!customerId} onClick={() => setStep(2)} className="gap-2">
              Next <ArrowRight className="size-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === 2 && (
        <Card className="glass-card rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="size-5" />
              Upload spreadsheet
            </CardTitle>
            <CardDescription>
              For {selectedCustomer?.name ?? 'customer'}. Any CSV or Excel layout — we read each
              row and pull the job details out of it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              className={cn(
                'flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8',
                isDragging
                  ? 'border-brand-primary bg-brand-primary/10'
                  : 'border-muted-foreground/25 hover:border-brand-primary/50'
              )}
              onClick={() => document.getElementById('csv-file-input')?.click()}
            >
              <input
                id="csv-file-input"
                type="file"
                accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <Upload className="size-10 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">
                {csvFile ? csvFile.name : 'Drop file here or click to browse'}
              </p>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
              <ArrowLeft className="size-4" /> Back
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === 3 && (
        <Card className="glass-card rounded-2xl">
          <CardHeader>
            <CardTitle>Review &amp; import</CardTitle>
            <CardDescription>
              What we read from each row for {selectedCustomer?.name}. Rows with problems are
              editable here — fix them in place, no need to change the spreadsheet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isExtracting && (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Reading rows… {extractedCount} of {csvData.length}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary transition-all duration-300"
                    style={{ width: `${extractionPercent}%` }}
                  />
                </div>
              </div>
            )}
            {!isExtracting && preparedRows.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Every spreadsheet column is kept with each job (sheet fields) and stays
                searchable after import — hover the info icon on a row to see them.
              </p>
            )}
            <div className="max-h-[420px] overflow-auto rounded-lg border">
              <SourceFieldsPeekProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Address</TableHead>
                      <TableHead>Postcode</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>Finish</TableHead>
                      <TableHead>Job length</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Sheet fields</TableHead>
                      <TableHead>Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preparedRows.map((row) => (
                      <TableRow
                        key={row.rowIndex}
                        className={cn(!row.ok && 'bg-destructive/10')}
                      >
                        <TableCell>
                          {row.ok ? (
                            <CheckCircle2 className="size-4 text-green-600" />
                          ) : (
                            <span className="inline-block size-2 rounded-full bg-destructive" />
                          )}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate">
                          {row.ok ? (
                            row.address || '—'
                          ) : (
                            <EditableCell
                              value={row.address}
                              placeholder="Address"
                              onCommit={(v) => setRowEdit(row.rowIndex, 'address', v)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {row.ok ? (
                            row.postcode || '—'
                          ) : (
                            <EditableCell
                              value={row.rawPostcode}
                              placeholder="Postcode"
                              onCommit={(v) => setRowEdit(row.rowIndex, 'postcode', v)}
                            />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {row.ok ? (
                            row.scheduledDate || '—'
                          ) : (
                            <EditableCell
                              value={row.rawScheduledDate}
                              placeholder="YYYY-MM-DD"
                              onCommit={(v) => setRowEdit(row.rowIndex, 'scheduledDate', v)}
                            />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {row.ok ? (
                            row.startTime || '—'
                          ) : (
                            <EditableCell
                              value={row.startTime ?? ''}
                              placeholder="HH:MM"
                              onCommit={(v) => setRowEdit(row.rowIndex, 'startTime', v)}
                            />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {row.ok ? (
                            row.endTime || '—'
                          ) : (
                            <EditableCell
                              value={row.endTime ?? ''}
                              placeholder="HH:MM"
                              onCommit={(v) => setRowEdit(row.rowIndex, 'endTime', v)}
                            />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {row.jobLength ? row.jobLength.replace('_', ' ') : '—'}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm">
                          {row.ok ? (
                            row.description || '—'
                          ) : (
                            <EditableCell
                              value={row.description}
                              placeholder="Description"
                              onCommit={(v) => setRowEdit(row.rowIndex, 'description', v)}
                            />
                          )}
                        </TableCell>
                        <TableCell className="align-middle">
                          <SourceFieldsPeek sourceFields={row.sourceFields} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {!row.ok && (
                            <span className="text-destructive">{row.errors.join(', ')}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </SourceFieldsPeekProvider>
            </div>

            <fieldset className="space-y-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">After import</legend>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  className="mt-1"
                  checked={autoAllocate}
                  onChange={() => setAutoAllocate(true)}
                  disabled={isImporting}
                />
                <span className="text-sm">
                  <span className="font-medium">Auto-allocate to workers</span>
                  <span className="block text-xs text-muted-foreground">
                    Assign by skills, location, and availability
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  className="mt-1"
                  checked={!autoAllocate}
                  onChange={() => setAutoAllocate(false)}
                  disabled={isImporting}
                />
                <span className="text-sm">
                  <span className="font-medium">Import only — assign manually</span>
                </span>
              </label>
            </fieldset>

            {rowStats.hasInvalidRows && !isExtracting && (
              <fieldset className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                <legend className="px-1 text-sm font-medium text-amber-900 dark:text-amber-100">
                  {rowStats.invalidCount} row
                  {rowStats.invalidCount === 1 ? '' : 's'} can&apos;t be imported
                </legend>
                <p className="text-sm text-muted-foreground">
                  Fix them in the table above, or tick below to import the{' '}
                  {rowStats.readyCount} good row
                  {rowStats.readyCount === 1 ? '' : 's'} and add the rest manually later.
                </p>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={allowPartialImport}
                    onChange={(e) => setAllowPartialImport(e.target.checked)}
                    disabled={isImporting || rowStats.readyCount === 0}
                  />
                  <span className="text-sm">
                    <span className="font-medium">
                      Import the {rowStats.readyCount} good row
                      {rowStats.readyCount === 1 ? '' : 's'} only
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      I&apos;ll add the skipped jobs manually later
                    </span>
                  </span>
                </label>
              </fieldset>
            )}
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                {rowStats.readyCount} of {csvData.length} rows ready
              </p>
              {rowStats.hasInvalidRows && !allowPartialImport && !isExtracting && (
                <p className="text-amber-700 dark:text-amber-300">
                  Import blocked until every row is valid, or you opt in to a partial import
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Button
                variant="gradient"
                disabled={
                  isImporting ||
                  isExtracting ||
                  rowStats.readyCount === 0 ||
                  (rowStats.hasInvalidRows && !allowPartialImport)
                }
                onClick={() => void handleImport()}
                className="gap-2"
              >
                {isImporting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Upload className="size-5" />
                )}
                {rowStats.hasInvalidRows && !allowPartialImport
                  ? 'Fix rows to import'
                  : autoAllocate
                    ? `Import & allocate ${rowStats.readyCount}`
                    : `Import ${rowStats.readyCount}`}
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}

      {step === 'done' && importResult && importResult.ok && (
        <Card className="glass-card rounded-2xl border-green-500/30">
          <CardHeader className="relative pr-10">
            <button
              type="button"
              aria-label="Dismiss"
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={resetWizard}
            >
              <X className="size-4" />
            </button>
            <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="size-5" />
              Import complete
            </CardTitle>
            <CardDescription>Results stay here until you dismiss them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Imported <strong>{importResult.count}</strong> job
              {importResult.count === 1 ? '' : 's'}
              {importResult.autoAllocate
                ? ` · ${importResult.assignedCount} assigned · ${importResult.unassignedCount} need manual assignment`
                : ' · assign them from the Jobs list'}
              .
            </p>
            {importResult.allocationFailures.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {importResult.allocationFailures.length} job
                  {importResult.allocationFailures.length === 1 ? '' : 's'} imported but
                  couldn&apos;t be allocated
                </p>
                <p className="mt-1 text-xs text-amber-950/80 dark:text-amber-50/80">
                  They&apos;re saved and waiting in the Jobs list — assign them manually, or fix
                  the underlying issue and auto-assign again.
                </p>
                <ul className="mt-2 space-y-2 text-amber-950/90 dark:text-amber-50/90">
                  {importResult.allocationFailures.slice(0, 12).map((f, i) => (
                    <li key={i} className="border-l-2 border-amber-500/40 pl-2">
                      <span className="font-medium">{f.reference || '(no reference)'}</span>
                      {(f.address || f.postcode) && (
                        <span className="text-xs">
                          {' '}
                          — {[f.address, f.postcode].filter(Boolean).join(', ')}
                        </span>
                      )}
                      <span className="block text-xs">{f.reason}</span>
                    </li>
                  ))}
                </ul>
                {importResult.allocationFailures.length > 12 && (
                  <p className="mt-1 text-xs">
                    …and {importResult.allocationFailures.length - 12} more
                  </p>
                )}
              </div>
            )}
            {importResult.errors.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {importResult.errors.length} row warning
                  {importResult.errors.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-950/90 dark:text-amber-50/90">
                  {importResult.errors.slice(0, 12).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                {importResult.errors.length > 12 && (
                  <p className="mt-1 text-xs">…and {importResult.errors.length - 12} more</p>
                )}
              </div>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="gradient" asChild>
              <Link href="/jobs">Go to Jobs</Link>
            </Button>
            <Button variant="outline" onClick={resetWizard}>
              Import another file
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === 'done' && importResult && !importResult.ok && (
        <Card className="glass-card rounded-2xl border-destructive/40">
          <CardHeader className="relative pr-10">
            <button
              type="button"
              aria-label="Close"
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={dismissImportResult}
            >
              <X className="size-4" />
            </button>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-5" />
              Import failed
            </CardTitle>
            <CardDescription>
              Nothing was written — fix the issues and try again. This stays until you close it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{importResult.errorMessage ?? 'No jobs were imported.'}</p>
            {importResult.errors.length > 0 && (
              <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-muted-foreground">
                {importResult.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {importResult.errors.length > 20 && (
              <p className="text-xs text-muted-foreground">
                …and {importResult.errors.length - 20} more
              </p>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="outline" onClick={dismissImportResult}>
              Back to review
            </Button>
            <Button variant="outline" onClick={resetWizard}>
              Start over
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
