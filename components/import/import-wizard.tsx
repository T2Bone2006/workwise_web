'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import {
  Upload,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Loader2,
  MapPin,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { importJobs } from '@/lib/actions/import';
import { createCustomerForImport } from '@/lib/actions/customers';
import {
  collectUnparsedDateValues,
  headerSetsEqual,
  isScheduledDateMapped,
  parseScheduledDate,
} from '@/lib/import/parse-scheduled-date';
import {
  normalizeHeaders,
  normalizeRowKeys,
  snapColumnMapping,
} from '@/lib/import/bind-columns';
import {
  EMPTY_RESOLVE_MAPS,
  areCoreColumnsMapped,
  collectJobLengthsNeedingAi,
  collectPostcodesNeedingAi,
  isJobLengthMapped,
  prepareImportRow,
  prepareImportRows,
  type ImportResolveMaps,
} from '@/lib/import/prepare-import-rows';
import { resolveImportDatesWithAI } from '@/lib/import/resolve-import-dates';
import { resolveImportPostcodesWithAI } from '@/lib/import/resolve-import-postcodes';
import { resolveImportJobLengthsWithAI } from '@/lib/import/resolve-import-job-lengths';
import type { CustomerImportOption } from '@/lib/data/customers';
import { SourceFieldsPeek, SourceFieldsPeekProvider } from '@/components/import/source-fields-peek';

/** WorkWise fields — customer comes from step 1, not the sheet. */
const SCHEMA_FIELDS = [
  { key: 'address', label: 'Address' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'description', label: 'Description' },
  { key: 'priority', label: 'Priority' },
  { key: 'job_length', label: 'Job length' },
  { key: 'reference_number', label: 'Reference number' },
  { key: 'scheduled_date', label: 'Scheduled date' },
] as const;

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'emergency'];

function cleanSavedMapping(
  mapping: Record<string, string | null> | null,
  headers?: string[]
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  if (!mapping) return cleaned;
  const snapped = headers ? snapColumnMapping(mapping, headers) : mapping;
  Object.entries(snapped).forEach(([k, v]) => {
    if (k === 'customer_name') return;
    if (v != null && v !== '') cleaned[k] = v;
  });
  return cleaned;
}

/** Decide whether saved mapping can be reused for this file's headers. */
function resolveSavedMappingReuse(
  headers: string[],
  saved: Record<string, string>,
  expected: string[]
): { reuse: boolean; headersChanged: boolean } {
  if (expected.length > 0) {
    const equal = headerSetsEqual(headers, expected);
    return { reuse: equal, headersChanged: !equal };
  }
  const headerSet = new Set(headers);
  const mappedCols = Object.values(saved);
  const allPresent = mappedCols.every((c) => headerSet.has(c));
  return { reuse: allPresent, headersChanged: !allPresent };
}

function isSpreadsheetImportFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.csv') || lower.endsWith('.xlsx');
}

function xlsxWorkbookToRowRecords(wb: XLSX.WorkBook): Record<string, string>[] {
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw: false,
  });
  return json
    .map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v == null ? '' : String(v);
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
  /** Hard failure message when ok is false. */
  errorMessage?: string;
};

interface ImportWizardProps {
  tenantId: string;
  customers: CustomerImportOption[];
}

export function ImportWizard({ customers: initialCustomers }: ImportWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 'adjust' | 'done'>(1);
  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [previewData, setPreviewData] = useState<Record<string, string>[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [valueTransforms, setValueTransforms] = useState<Record<string, Record<string, string>>>({});
  const [headersChanged, setHeadersChanged] = useState(false);
  const [isAiMapping, setIsAiMapping] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [autoAllocate, setAutoAllocate] = useState(true);
  /** When false (default), any invalid row blocks the whole import. */
  const [allowPartialImport, setAllowPartialImport] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultState | null>(null);
  const [resolveMaps, setResolveMaps] = useState<ImportResolveMaps>(EMPTY_RESOLVE_MAPS);
  const [isResolvingFields, setIsResolvingFields] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(true);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  const runAiMapping = useCallback(async (headers: string[], rows: Record<string, string>[]) => {
    if (!headers.length) return;
    setIsAiMapping(true);
    try {
      const res = await fetch('/api/map-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columnNames: headers,
          sampleRows: rows.slice(0, 5),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'AI mapping failed');
      }
      const { mapping, transforms } = (await res.json()) as {
        mapping?: Record<string, string | null>;
        transforms?: Record<string, Record<string, string>>;
      };

      // Belt-and-suspenders: snap again on the client against this file's headers.
      const snapped = snapColumnMapping(mapping ?? {}, headers);
      const cleaned: Record<string, string> = {};
      Object.entries(snapped).forEach(([k, v]) => {
        if (k === 'customer_name') return;
        if (v) cleaned[k] = v;
      });
      setColumnMapping(cleaned);
      setValueTransforms(transforms ?? {});

      // Hard mapping failure only when address or postcode missing.
      // (Description / date / job_length rules are separate; don't lecture in this toast.)
      if (!cleaned.address || !cleaned.postcode) {
        toast.error(
          'Address and/or postcode could not be mapped. Open Adjust mapping and fix them.',
          { duration: 14000 }
        );
      } else {
        toast.success('Columns mapped', { duration: 6000 });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI mapping failed. Adjust mapping manually.', {
        duration: 12000,
      });
    } finally {
      setIsAiMapping(false);
    }
  }, []);

  const resolveMappingAfterUpload = useCallback(
    async (headers: string[], rows: Record<string, string>[]) => {
      const saved = cleanSavedMapping(
        selectedCustomer?.import_column_mapping ?? null,
        headers
      );
      const expected = selectedCustomer?.import_expected_headers ?? [];
      const hasSaved = Object.keys(saved).length > 0;

      if (hasSaved) {
        const { reuse, headersChanged: changed } = resolveSavedMappingReuse(
          headers,
          saved,
          expected
        );
        if (reuse) {
          setColumnMapping(saved);
          setValueTransforms(selectedCustomer?.import_value_transforms ?? {});
          setHeadersChanged(false);
          setStep(3);
          toast.success('Reused saved column mapping for this customer', { duration: 6000 });
          return;
        }
        setHeadersChanged(changed);
      } else {
        setHeadersChanged(false);
      }
      await runAiMapping(headers, rows);
      setStep(3);
    },
    [selectedCustomer, runAiMapping]
  );

  // Absolute fields (dates, postcodes, job lengths): rules first, then AI — before Import.
  useEffect(() => {
    if (step !== 3 && step !== 'adjust') return;
    if (!csvData.length) return;

    let cancelled = false;
    setIsResolvingFields(true);
    setFieldsReady(false);

    void (async () => {
      try {
        const dateCol = columnMapping.scheduled_date;
        const dateInputs =
          isScheduledDateMapped(columnMapping) && dateCol
            ? [
                ...new Set(
                  collectUnparsedDateValues(csvData, dateCol).filter(
                    (v) => !parseScheduledDate(v)
                  )
                ),
              ]
            : [];
        const postcodeInputs = [
          ...new Set(collectPostcodesNeedingAi(csvData, columnMapping, valueTransforms)),
        ];
        const lengthInputs = [
          ...new Set(collectJobLengthsNeedingAi(csvData, columnMapping, valueTransforms)),
        ];

        const [dates, postcodes, jobLengths] = await Promise.all([
          dateInputs.length > 0
            ? resolveImportDatesWithAI(dateInputs)
            : Promise.resolve({} as Record<string, string>),
          postcodeInputs.length > 0
            ? resolveImportPostcodesWithAI(postcodeInputs)
            : Promise.resolve({} as Record<string, string>),
          lengthInputs.length > 0
            ? resolveImportJobLengthsWithAI(lengthInputs)
            : Promise.resolve({} as Record<string, 'half_day' | 'full_day'>),
        ]);

        if (!cancelled) {
          setResolveMaps({ dates, postcodes, jobLengths });
          setFieldsReady(true);
        }
      } catch (e) {
        console.error('[ImportWizard] absolute field resolve failed', e);
        if (!cancelled) {
          setResolveMaps(EMPTY_RESOLVE_MAPS);
          setFieldsReady(true);
        }
      } finally {
        if (!cancelled) setIsResolvingFields(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, columnMapping, csvData, valueTransforms]);

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
          setCsvHeaders([]);
          setCsvData([]);
          setPreviewData([]);
          return;
        }
        const rawHeaders = Object.keys(rows[0]!);
        const headers = normalizeHeaders(rawHeaders);
        if (!headers.length) {
          toast.error('File has no usable column headers.', { duration: 8000 });
          return;
        }
        const normalizedRows = rows.map((row) => normalizeRowKeys(row, headers));
        setCsvHeaders(headers);
        setCsvData(normalizedRows);
        setPreviewData(normalizedRows.slice(0, 5));
        setAllowPartialImport(false);
        void resolveMappingAfterUpload(headers, normalizedRows);
      };

      const lower = file.name.toLowerCase();
      if (lower.endsWith('.xlsx')) {
        void (async () => {
          try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
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
    [resolveMappingAfterUpload]
  );

  const importRowStats = useMemo(() => {
    const prepared = prepareImportRows(
      csvData,
      columnMapping,
      valueTransforms,
      resolveMaps,
      { absoluteFieldsReady: fieldsReady && !isResolvingFields }
    );
    const readyCount = prepared.filter((r) => r.ok).length;
    const coreMapped = areCoreColumnsMapped(columnMapping);
    return {
      readyCount,
      invalidCount: csvData.length - readyCount,
      pendingFieldCount: prepared.filter((r) =>
        r.warnings.some((w) => w.startsWith('Resolving '))
      ).length,
      hasInvalidRows: prepared.some((r) => !r.ok),
      coreMapped,
    };
  }, [csvData, columnMapping, valueTransforms, resolveMaps, fieldsReady, isResolvingFields]);

  const applyMappingAndReview = () => {
    setAllowPartialImport(false);
    setResolveMaps(EMPTY_RESOLVE_MAPS);
    setFieldsReady(false);
    setStep(3);
  };

  const mappedPreviewRows = useMemo(
    () =>
      previewData.slice(0, 10).map((row, i) =>
        prepareImportRow(
          row,
          i,
          columnMapping,
          valueTransforms,
          resolveMaps,
          { absoluteFieldsReady: fieldsReady && !isResolvingFields }
        )
      ),
    [previewData, columnMapping, valueTransforms, resolveMaps, fieldsReady, isResolvingFields]
  );

  const previewExtrasKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of mappedPreviewRows) {
      for (const k of Object.keys(row.sourceFields)) keys.add(k);
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [mappedPreviewRows]);

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
    if (!customerId || !csvData.length) {
      toast.error('Select a customer and upload a file first.', { duration: 8000 });
      return;
    }
    if (isResolvingFields || !fieldsReady) {
      toast.error('Still cleaning dates / postcodes / job lengths — wait a moment.', {
        duration: 8000,
      });
      return;
    }
    if (!areCoreColumnsMapped(columnMapping)) {
      toast.error('Map Address and Postcode before importing.', { duration: 10000 });
      return;
    }
    setIsImporting(true);
    try {
      const mapping: Record<string, string> = {};
      Object.entries(columnMapping).forEach(([field, csvColumn]) => {
        if (csvColumn && csvColumn !== '__NONE__') mapping[field] = csvColumn;
      });
      const result = await importJobs({
        customerId,
        columnMapping: mapping,
        valueTransforms,
        csvData,
        csvHeaders,
        fileName: csvFile?.name ?? 'import.csv',
        autoAllocate,
        allowPartialImport,
        preResolvedDates: resolveMaps.dates,
        preResolvedPostcodes: resolveMaps.postcodes,
        preResolvedJobLengths: resolveMaps.jobLengths,
      });

      if (result.success) {
        setImportResult({
          ok: true,
          count: result.count,
          assignedCount: result.assignedCount,
          unassignedCount: result.unassignedCount,
          errors: result.errors ?? [],
          autoAllocate,
        });
        setStep('done');
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === customerId
              ? {
                  ...c,
                  import_column_mapping: mapping,
                  import_value_transforms: valueTransforms,
                  import_expected_headers: csvHeaders,
                }
              : c
          )
        );
      } else {
        setImportResult({
          ok: false,
          count: 0,
          assignedCount: 0,
          unassignedCount: 0,
          errors: result.errors ?? [],
          autoAllocate,
          errorMessage: result.error,
        });
        setStep('done');
      }
    } catch (e) {
      setImportResult({
        ok: false,
        count: 0,
        assignedCount: 0,
        unassignedCount: 0,
        errors: [],
        autoAllocate,
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
    setCsvHeaders([]);
    setCsvData([]);
    setPreviewData([]);
    setColumnMapping({});
    setValueTransforms({});
    setHeadersChanged(false);
    setImportResult(null);
    setResolveMaps(EMPTY_RESOLVE_MAPS);
    setFieldsReady(true);
    setIsResolvingFields(false);
    setAllowPartialImport(false);
  };

  const dismissImportResult = () => {
    setImportResult(null);
    setStep(3);
  };

  const stepLabel =
    step === 1
      ? 'Customer'
      : step === 2
        ? 'Upload'
        : step === 3
          ? 'Review'
          : step === 'adjust'
            ? 'Adjust mapping'
            : 'Done';

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
              width: `${
                step === 1 ? 33 : step === 2 ? 66 : step === 3 || step === 'adjust' || step === 'done' ? 100 : 0
              }%`,
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
            <CardDescription>
              Pick the customer these jobs belong to. We&apos;ll remember how their sheets map for
              next time.
            </CardDescription>
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
            <Button
              disabled={!customerId}
              onClick={() => setStep(2)}
              className="gap-2"
            >
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
              For {selectedCustomer?.name ?? 'customer'}. CSV or Excel — we&apos;ll map columns
              automatically.
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
              {isAiMapping ? (
                <Loader2 className="size-10 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="size-10 text-muted-foreground" />
              )}
              <p className="mt-2 text-sm font-medium">
                {isAiMapping
                  ? 'Mapping columns…'
                  : csvFile
                    ? csvFile.name
                    : 'Drop file here or click to browse'}
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
            <CardTitle>Review & import</CardTitle>
            <CardDescription>
              Check a sample of jobs for {selectedCustomer?.name}. Fix mapping if anything looks
              wrong.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {headersChanged && (
              <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm">
                This spreadsheet&apos;s columns changed since the last import for this customer.
                We&apos;ve remapped it — review before importing. The new layout is saved when
                import succeeds.
              </div>
            )}
            {isAiMapping && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Mapping columns…
              </p>
            )}
            {isResolvingFields && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Cleaning dates, postcodes & job
                lengths…
              </p>
            )}
            {previewExtrasKeys.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Unmapped columns are stored with each job. After import you&apos;ll
                be able to search and filter by them — hover the info icon on a row
                to see which fields that job will keep. Description becomes a short
                summary, not a spreadsheet dump.
              </p>
            )}
            <div className="max-h-[400px] overflow-auto rounded-lg border">
              <SourceFieldsPeekProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Address</TableHead>
                    <TableHead>Postcode</TableHead>
                    <TableHead>Scheduled date</TableHead>
                    <TableHead>Job length</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Stored fields</TableHead>
                    <TableHead>Issues</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappedPreviewRows.map((prepared, i) => {
                    const extraCount = Object.keys(prepared.sourceFields).length;
                    return (
                    <TableRow
                      key={i}
                      className={cn(
                        !prepared.ok && 'bg-destructive/10',
                        prepared.ok && prepared.warnings.length > 0 && 'bg-amber-500/10'
                      )}
                    >
                      <TableCell>
                        {prepared.ok ? (
                          prepared.warnings.length > 0 ? (
                            <span className="inline-block size-2 rounded-full bg-amber-500" />
                          ) : (
                            <CheckCircle2 className="size-4 text-green-600" />
                          )
                        ) : (
                          <span className="inline-block size-2 rounded-full bg-destructive" />
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">{prepared.address}</TableCell>
                      <TableCell>{prepared.postcode || prepared.rawPostcode || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {isScheduledDateMapped(columnMapping)
                          ? prepared.scheduledDate || prepared.rawScheduledDate || '—'
                          : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {isJobLengthMapped(columnMapping)
                          ? prepared.jobLength || prepared.rawJobLength || '—'
                          : prepared.jobLength || '—'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {prepared.mappedDescription.trim() ||
                          (extraCount > 0 ? '(summary on import)' : '—')}
                      </TableCell>
                      <TableCell className="align-middle">
                        <SourceFieldsPeek sourceFields={prepared.sourceFields} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {!prepared.ok && (
                          <span className="text-destructive">{prepared.errors.join(', ')}</span>
                        )}
                        {prepared.ok && prepared.warnings.length > 0 && (
                          <span className="text-amber-700 dark:text-amber-300">
                            {prepared.warnings.join(', ')}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
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

            {!importRowStats.coreMapped && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
                <p className="font-medium text-destructive">Address and Postcode must be mapped</p>
                <p className="mt-1 text-muted-foreground">
                  Unmapped postcode blocks the whole import (we won&apos;t guess a postcode
                  column). Use Adjust mapping, then Apply &amp; review.
                </p>
              </div>
            )}

            {importRowStats.hasInvalidRows && importRowStats.coreMapped && (
              <fieldset className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                <legend className="px-1 text-sm font-medium text-amber-900 dark:text-amber-100">
                  {importRowStats.invalidCount} row
                  {importRowStats.invalidCount === 1 ? '' : 's'} can&apos;t be imported
                </legend>
                <p className="text-sm text-muted-foreground">
                  By default the whole file is blocked so you can fix the spreadsheet and import
                  everything together. Tick below only if you&apos;re happy to import the{' '}
                  {importRowStats.readyCount} valid row
                  {importRowStats.readyCount === 1 ? '' : 's'} and add the rest manually later.
                </p>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={allowPartialImport}
                    onChange={(e) => setAllowPartialImport(e.target.checked)}
                    disabled={isImporting || importRowStats.readyCount === 0}
                  />
                  <span className="text-sm">
                    <span className="font-medium">
                      Import the {importRowStats.readyCount} valid row
                      {importRowStats.readyCount === 1 ? '' : 's'} only
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
                {importRowStats.readyCount} of {csvData.length} rows ready
              </p>
              {importRowStats.hasInvalidRows && !allowPartialImport && importRowStats.coreMapped && (
                <p className="text-amber-700 dark:text-amber-300">
                  Import blocked until every row is valid, or you opt in to a partial import
                </p>
              )}
              {!importRowStats.coreMapped && (
                <p className="text-destructive">Map Address and Postcode to import</p>
              )}
              {importRowStats.hasInvalidRows && allowPartialImport && (
                <p className="text-amber-700 dark:text-amber-300">
                  Partial import: {importRowStats.invalidCount} row
                  {importRowStats.invalidCount === 1 ? '' : 's'} will be skipped
                </p>
              )}
              {importRowStats.pendingFieldCount > 0 && (
                <p className="text-muted-foreground">Cleaning fields before import…</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Button variant="outline" onClick={() => setStep('adjust')} className="gap-2">
                <MapPin className="size-4" />
                Adjust mapping
              </Button>
              <Button
                variant="gradient"
                disabled={
                  isImporting ||
                  importRowStats.readyCount === 0 ||
                  isAiMapping ||
                  isResolvingFields ||
                  !fieldsReady ||
                  !importRowStats.coreMapped ||
                  (importRowStats.hasInvalidRows && !allowPartialImport)
                }
                onClick={() => void handleImport()}
                className="gap-2"
              >
                {isImporting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Upload className="size-5" />
                )}
                {!importRowStats.coreMapped
                  ? 'Map address & postcode'
                  : importRowStats.hasInvalidRows && !allowPartialImport
                    ? 'Fix rows to import'
                    : autoAllocate
                      ? `Import & allocate ${importRowStats.readyCount}`
                      : `Import ${importRowStats.readyCount}`}
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}

      {step === 'adjust' && (
        <Card className="glass-card rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="size-5" />
              Adjust column mapping
            </CardTitle>
            <CardDescription>
              Match spreadsheet columns to WorkWise fields. Unmapped columns are kept in
              source fields; description becomes a short summary on import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="gradient"
              onClick={() => void runAiMapping(csvHeaders, csvData)}
              disabled={isAiMapping}
              className="gap-2"
            >
              {isAiMapping ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Sparkles className="size-5" />
              )}
              AI map columns
            </Button>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Our field</TableHead>
                    <TableHead className="w-12" />
                    <TableHead>CSV column</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SCHEMA_FIELDS.map(({ key, label }) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="text-muted-foreground">←</TableCell>
                      <TableCell>
                        {key === 'priority' ? (
                          <Select
                            value={columnMapping[key] ?? '__default__'}
                            onValueChange={(v) =>
                              setColumnMapping((m) => {
                                if (v === '__default__') {
                                  const next = { ...m };
                                  delete next.priority;
                                  return next;
                                }
                                return { ...m, priority: v };
                              })
                            }
                          >
                            <SelectTrigger className="max-w-[220px]">
                              <SelectValue placeholder="Default: normal" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">Default: normal</SelectItem>
                              {PRIORITY_OPTIONS.map((p) => (
                                <SelectItem key={p} value={p}>
                                  {p}
                                </SelectItem>
                              ))}
                              {csvHeaders.map((h) => (
                                <SelectItem key={h} value={h}>
                                  From CSV: {h}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Select
                            value={columnMapping[key] ?? '__NONE__'}
                            onValueChange={(v) =>
                              setColumnMapping((m) => {
                                const next = { ...m };
                                if (v && v !== '__NONE__') next[key] = v;
                                else delete next[key];
                                return next;
                              })
                            }
                          >
                            <SelectTrigger className="max-w-[220px]">
                              <SelectValue placeholder="Not mapped" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__NONE__">Not mapped</SelectItem>
                              {csvHeaders.map((h) => (
                                <SelectItem key={h} value={h}>
                                  {h}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="gradient" onClick={applyMappingAndReview} className="gap-2">
              Apply &amp; review
              <ArrowRight className="size-4" />
            </Button>
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
            <p className="text-muted-foreground">
              Column mapping for {selectedCustomer?.name ?? 'this customer'} was saved for next
              time.
            </p>
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
              <a href="/jobs">Go to Jobs</a>
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
              Nothing was saved for next time — fix the issues and try again. This stays until
              you close it.
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
