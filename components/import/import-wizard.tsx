'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import {
  Upload,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Check,
  Loader2,
  MapPin,
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
import { cn } from '@/lib/utils';
import { importJobs } from '@/lib/actions/import';
import type { ImportSourceRow } from '@/lib/data/import-sources';

const SCHEMA_FIELDS = [
  { key: 'customer_name', label: 'Customer name', required: true },
  { key: 'address', label: 'Address', required: true },
  { key: 'postcode', label: 'Postcode', required: true },
  { key: 'description', label: 'Description', required: false },
  { key: 'priority', label: 'Priority', required: true },
  { key: 'reference_number', label: 'Reference number', required: false },
  { key: 'scheduled_date', label: 'Scheduled date', required: false },
  { key: 'worker_name', label: 'Worker name', required: false },
] as const;

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'];

function isSpreadsheetImportFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.csv') || lower.endsWith('.xlsx');
}

/** Matches PapaParse `header: true` rows: object per row, string cell values, skipped empty lines. */
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

interface ImportWizardProps {
  tenantId: string;
  initialSources: ImportSourceRow[];
}

export function ImportWizard({ tenantId, initialSources }: ImportWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [valueTransforms, setValueTransforms] = useState<Record<string, Record<string, string>>>({});
  const [previewData, setPreviewData] = useState<Record<string, string>[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [useSavedMapping, setUseSavedMapping] = useState(false);
  const [showRemap, setShowRemap] = useState(false);
  const [isAiMapping, setIsAiMapping] = useState(false);

  const sources = initialSources;

  const canGoStep2 = sourceId !== null || sourceName.trim().length > 0;
  const canGoStep3 = csvFile && csvHeaders.length > 0 && csvData.length > 0;
  const hasRequiredMapping =
    columnMapping.address &&
    columnMapping.postcode &&
    columnMapping.customer_name;
  const priorityMapped = columnMapping.priority ?? 'normal';

  const handleFile = useCallback((file: File) => {
    if (!isSpreadsheetImportFile(file.name)) {
      toast.error('Please upload a .csv or .xlsx file.');
      return;
    }
    setCsvFile(file);

    const applyParsedRows = (rows: Record<string, string>[]) => {
      if (!rows.length) {
        toast.error('File has no data rows.');
        setCsvHeaders([]);
        setCsvData([]);
        setPreviewData([]);
        return;
      }
      const headers = Object.keys(rows[0]!);
      setCsvHeaders(headers);
      setCsvData(rows);
      setPreviewData(rows.slice(0, 5));
    };

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.xlsx')) {
      void (async () => {
        try {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: 'array' });
          const rows = xlsxWorkbookToRowRecords(wb);
          applyParsedRows(rows);
        } catch {
          toast.error('Invalid Excel file. Could not parse workbook.');
          setCsvHeaders([]);
          setCsvData([]);
          setPreviewData([]);
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
      error: () => {
        toast.error('Invalid CSV format. Could not parse file.');
        setCsvHeaders([]);
        setCsvData([]);
        setPreviewData([]);
      },
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleAiMapping = async () => {
    if (!csvHeaders.length) return;
    setIsAiMapping(true);
    try {
      const res = await fetch('/api/map-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnNames: csvHeaders }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'AI mapping failed');
      }
      const { mapping, transforms } = await res.json();
      const cleaned: Record<string, string> = {};
      Object.entries(mapping ?? {}).forEach(([k, v]) => {
        if (v && typeof v === 'string') cleaned[k] = v;
      });
      setColumnMapping(cleaned);
      setValueTransforms(transforms ?? {});
      toast.success('AI mapped columns and value transforms');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI mapping failed. Use manual mapping.');
    } finally {
      setIsAiMapping(false);
    }
  };

  const applyTransforms = (field: string, raw: string): string => {
    const t = valueTransforms[field];
    if (!t) return raw;
    const key = raw.trim();
    return t[key] ?? t['default'] ?? raw;
  };

  const mappedPreviewRows = previewData.slice(0, 10).map((row) => {
    const out: Record<string, string> = {};
    SCHEMA_FIELDS.forEach(({ key }) => {
      const csvCol = columnMapping[key];
      let val = csvCol && row[csvCol] != null ? String(row[csvCol]).trim() : '';
      if (val && valueTransforms[key]) val = applyTransforms(key, val);
      out[key] = val;
    });
    if (!out.priority) out.priority = valueTransforms.priority?.default ?? 'normal';
    return out;
  });

  const handleImport = async () => {
    if (!hasRequiredMapping || !csvData.length) {
      toast.error('Complete column mapping and ensure CSV has data.');
      return;
    }
    setIsImporting(true);
    const started = Date.now();
    try {
      const mapping: Record<string, string> = {};
      Object.entries(columnMapping).forEach(([field, csvColumn]) => {
        if (csvColumn && csvColumn !== '__NONE__') {
          mapping[field] = csvColumn;
        }
      });
      const result = await importJobs({
        sourceId,
        sourceName: sourceId ? sources.find((s) => s.id === sourceId)?.source_name ?? sourceName : sourceName,
        columnMapping: mapping,
        valueTransforms,
        csvData,
        fileName: csvFile?.name ?? 'import.csv',
      });
      const duration = Math.round((Date.now() - started) / 1000);
      if (result.success && result.count != null) {
        const assigned = 'assignedCount' in result ? result.assignedCount : 0;
        const unassigned = 'unassignedCount' in result ? result.unassignedCount : 0;
        let msg = `Imported ${result.count} jobs.`;
        if (assigned > 0) msg += ` ${assigned} assigned to workers by location and availability.`;
        if (assigned === 0 && unassigned === 0) msg = `Imported ${result.count} jobs successfully.`;
        toast.success(msg);
        if (unassigned > 0) {
          toast.warning(
            `${unassigned} job${unassigned === 1 ? '' : 's'} need manual assignment`,
            {
              description: 'Auto-assign failed (e.g. invalid postcode or no available workers). Assign them from the Jobs list.',
              duration: 8000,
            }
          );
        }
        router.push('/jobs');
      } else if (!result.success) {
        toast.error('error' in result ? result.error : 'Import failed');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const selectedSource = sourceId ? sources.find((s) => s.id === sourceId) : null;
  const savedMapping = selectedSource?.column_mapping ?? {};
  const hasSavedMapping = selectedSource && Object.keys(savedMapping).length > 0;
  const skipMappingStep = hasSavedMapping && (useSavedMapping || step < 3) && !showRemap;

  const stepProgress = (step / 4) * 100;

  return (
    <div className="space-y-6">
      {/* Step indicator + progress */}
      <div
        className={cn(
          'rounded-2xl border p-6 transition-all duration-300',
          'bg-[var(--glass-bg)] border-[var(--glass-border)] shadow-[var(--shadow-glass-value)]',
          'backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <div className="mb-4 flex items-center justify-between text-sm font-medium text-muted-foreground">
          <span>Step {step} of 4</span>
          <span>
            {step === 1 && 'Select source'}
            {step === 2 && 'Upload file'}
            {step === 3 && 'Map columns'}
            {step === 4 && 'Preview & import'}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary transition-all duration-500"
            style={{ width: `${stepProgress}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
          <span>1. Source</span>
          <span>2. Upload</span>
          <span>3. Map</span>
          <span>4. Import</span>
        </div>
      </div>

      {/* Step 1: Select/Create Import Source */}
      {step === 1 && (
        <Card className="glass-card overflow-hidden rounded-2xl border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5" />
              Select or create import source
            </CardTitle>
            <CardDescription>
              Choose an existing source to reuse a saved column mapping, or create a new one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Import source</Label>
              <Select
                value={sourceId ?? 'new'}
                onValueChange={(v) => {
                  setSourceId(v === 'new' ? null : v);
                  if (v !== 'new') {
                    const s = sources.find((x) => x.id === v);
                    if (s) setSourceName(s.source_name);
                  } else {
                    setSourceName('');
                  }
                }}
              >
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder="Select or create..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New source...</SelectItem>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.source_name} {s.times_used > 0 && `(used ${s.times_used}×)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(sourceId === null || sourceId === 'new') && (
              <div className="space-y-2">
                <Label>New source name</Label>
                <Input
                  placeholder="e.g. Monthly Job Export"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  className="max-w-md"
                />
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button onClick={() => setStep(2)} disabled={!canGoStep2} className="gap-2">
              Next <ArrowRight className="size-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 2: Upload spreadsheet */}
      {step === 2 && (
        <Card className="glass-card overflow-hidden rounded-2xl border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="size-5" />
              Upload spreadsheet
            </CardTitle>
            <CardDescription>
              Drag and drop a CSV or Excel file, or click to browse. We'll detect headers and show a preview.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                'flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all duration-200',
                isDragging
                  ? 'border-brand-primary bg-brand-primary/10 shadow-[var(--shadow-glow-sm-value)]'
                  : 'border-muted-foreground/25 hover:border-brand-primary/50 hover:bg-muted/30'
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
              <p className="mt-2 text-sm font-medium text-foreground">
                {csvFile ? csvFile.name : 'Drop file here or click to browse'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">.csv or .xlsx</p>
            </div>
            {previewData.length > 0 && (
              <div className="space-y-2">
                <Label>Preview (first 3 rows)</Label>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {csvHeaders.map((h) => (
                          <TableHead key={h} className="whitespace-nowrap">
                            {h}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.slice(0, 3).map((row, i) => (
                        <TableRow key={i}>
                          {csvHeaders.map((h) => (
                            <TableCell key={h} className="max-w-[200px] truncate">
                              {row[h] ?? ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
              <ArrowLeft className="size-4" /> Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!canGoStep3} className="gap-2">
              Next <ArrowRight className="size-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 3: Column Mapping */}
      {step === 3 && (
        <Card className="glass-card overflow-hidden rounded-2xl border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="size-5" />
              Map columns
            </CardTitle>
            <CardDescription>
              {hasSavedMapping && !showRemap
                ? 'Use your saved mapping or remap columns.'
                : 'Let AI suggest mappings or choose manually.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {hasSavedMapping && !showRemap && (
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">
                  Saved mapping found for this source. You can use it as-is or remap.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="gradient"
                    className="gap-2"
                    onClick={() => {
                      const cleaned: Record<string, string> = {};
                      Object.entries(savedMapping).forEach(([k, v]) => {
                        if (v != null && v !== '') cleaned[k] = v;
                      });
                      setColumnMapping(cleaned);
                      setUseSavedMapping(true);
                      setStep(4);
                    }}
                  >
                    <Check className="size-4" /> Use saved mapping
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const cleaned: Record<string, string> = {};
                      Object.entries(savedMapping).forEach(([k, v]) => {
                        if (v != null && v !== '') cleaned[k] = v;
                      });
                      setColumnMapping(cleaned);
                      setShowRemap(true);
                    }}
                  >
                    Remap columns
                  </Button>
                </div>
              </div>
            )}
            {(showRemap || !hasSavedMapping) && (
              <>
                <div className="flex items-center gap-4">
                  <Button
                    variant="gradient"
                    size="lg"
                    onClick={handleAiMapping}
                    disabled={isAiMapping || !csvHeaders.length}
                    className="gap-2 shadow-[var(--shadow-btn-glow-value)]"
                  >
                    {isAiMapping ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : (
                      <Sparkles className="size-5" />
                    )}
                    AI map columns
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    We'll match your CSV headers to our job fields.
                  </span>
                </div>
                <div className="space-y-3">
                  <Label>Manual mapping</Label>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Our field</TableHead>
                          <TableHead className="w-12" />
                          <TableHead>CSV column</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {SCHEMA_FIELDS.map(({ key, label, required }) => (
                          <TableRow key={key} className={cn(key !== 'priority' && 'bg-muted/20')}>
                            <TableCell className="font-medium">
                              {label}
                              {required && <span className="text-destructive"> *</span>}
                            </TableCell>
                            <TableCell className="text-muted-foreground">←</TableCell>
                            <TableCell>
                              {key === 'priority' ? (
                                <Select
                                  value={columnMapping[key] ?? '__default__'}
                                  onValueChange={(v) =>
                                    setColumnMapping((m) =>
                                      v === '__default__'
                                        ? (() => {
                                            const next = { ...m };
                                            delete next.priority;
                                            return next;
                                          })()
                                        : { ...m, priority: v }
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-full max-w-[200px]">
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
                                  <SelectTrigger className="w-full max-w-[200px]">
                                    <SelectValue placeholder="Select column..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__NONE__">— None —</SelectItem>
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
                </div>
              </>
            )}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
              <ArrowLeft className="size-4" /> Back
            </Button>
            {(!hasSavedMapping || showRemap) && (
              <Button
                onClick={() => setStep(4)}
                disabled={!hasRequiredMapping}
                className="gap-2"
              >
                Next <ArrowRight className="size-4" />
              </Button>
            )}
          </CardFooter>
        </Card>
      )}

      {/* Step 4: Preview & Import */}
      {step === 4 && (
        <Card className="glass-card overflow-hidden rounded-2xl border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)]">
          <CardHeader>
            <CardTitle>Preview & import</CardTitle>
            <CardDescription>
              First 10 rows mapped to our schema. Click Import to create {csvData.length} jobs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Postcode</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Priority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappedPreviewRows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-[140px] truncate">{row.customer_name}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{row.address}</TableCell>
                      <TableCell>{row.postcode}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{row.description}</TableCell>
                      <TableCell>{row.priority}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          <CardFooter className="flex items-center gap-4">
            <Button variant="outline" onClick={() => setStep(3)} className="gap-2">
              <ArrowLeft className="size-4" /> Back
            </Button>
            <Button
              variant="gradient"
              onClick={handleImport}
              disabled={isImporting}
              className="gap-2 shadow-[var(--shadow-btn-glow-value)]"
            >
              {isImporting ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Upload className="size-5" />
              )}
              Import {csvData.length} jobs
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
