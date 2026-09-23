'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { JobRow, JobsFilters, ExportJobRow } from '@/lib/data/jobs';
import { EXPORT_MAX_ROWS } from '@/lib/jobs/export-limits';
import { getJobsForExportAction } from '@/lib/actions/jobs';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';

interface ExportJobsButtonProps {
  jobs: JobRow[];
  totalCount: number;
  filters: JobsFilters;
  /** Checked row IDs on the current page (for the Selected scope). */
  selectedIds?: string[];
}

/** Rows exported may come from the current page (JobRow, no lifecycle timestamps) or a
 * server fetch (ExportJobRow) — columns that need the latter degrade to blank for page scope. */
type ExportableRow = JobRow &
  Partial<Pick<ExportJobRow, 'started_at' | 'arrived_at' | 'completed_at' | 'completion_notes'>>;

function formatDateForExport(value: string | null | undefined): string {
  if (!value) return '';

  const source = value.length <= 10 ? `${value}T12:00:00` : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

function formatDateTimeForExport(value: string | null | undefined): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function formatTodayForFilename(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const EXPORT_COLUMNS: {
  key: string;
  label: string;
  get: (job: ExportableRow) => string;
}[] = [
  { key: 'reference_number', label: 'Job Ref', get: (j) => j.reference_number ?? '' },
  { key: 'customer_name', label: 'Customer', get: (j) => j.customer_name ?? '' },
  { key: 'address', label: 'Address', get: (j) => j.address ?? '' },
  { key: 'postcode', label: 'Postcode', get: (j) => j.postcode ?? '' },
  { key: 'job_description', label: 'Job Type', get: (j) => j.job_description ?? '' },
  {
    key: 'status',
    label: 'Status',
    get: (j) => (j.status ? (JOB_STATUS_DISPLAY[j.status]?.label ?? j.status) : ''),
  },
  { key: 'worker_name', label: 'Assigned To', get: (j) => j.worker_name ?? 'Unassigned' },
  { key: 'scheduled_date', label: 'Scheduled Date', get: (j) => formatDateForExport(j.scheduled_date) },
  {
    key: 'start_time',
    label: 'Start Time',
    get: (j) => formatDateTimeForExport(j.started_at ?? j.arrived_at),
  },
  {
    key: 'completed_at',
    label: 'Completion Date & Time',
    get: (j) => formatDateTimeForExport(j.completed_at),
  },
  { key: 'completion_notes', label: 'Completion Notes', get: (j) => j.completion_notes ?? '' },
];

type Scope = 'page' | 'all' | 'custom' | 'selected';

/** Excel sheet names: max 31 chars, no \ / ? * [ ] */
function sanitizeSheetName(raw: string, used: Set<string>): string {
  let base = raw
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) base = 'Sheet';
  base = base.slice(0, 31);

  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function groupRowsByCustomer(rows: ExportableRow[]): Array<{
  sheetLabel: string;
  rows: ExportableRow[];
}> {
  const order: string[] = [];
  const groups = new Map<string, { sheetLabel: string; rows: ExportableRow[] }>();

  for (const job of rows) {
    const key = job.customer_id ?? '__none__';
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(job);
      continue;
    }
    order.push(key);
    groups.set(key, {
      sheetLabel: (job.customer_name ?? '').trim() || 'No customer',
      rows: [job],
    });
  }

  return order.map((key) => groups.get(key)!);
}

function sourceFieldKeysForGroup(rows: ExportableRow[]): string[] {
  const keys = new Set<string>();
  for (const job of rows) {
    const fields = job.source_fields ?? {};
    for (const key of Object.keys(fields)) {
      if (key.trim()) keys.add(key);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function buildAndDownloadWorkbook(
  rows: ExportableRow[],
  columnKeys: string[],
  opts: { fileName: string; sheetName?: string }
) {
  const systemColumns = EXPORT_COLUMNS.filter((c) => columnKeys.includes(c.key));
  const systemLabels = new Set(systemColumns.map((c) => c.label));
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const groups = groupRowsByCustomer(rows);
  const singleSheet = groups.length === 1;
  for (const group of groups) {
    const sourceKeys = sourceFieldKeysForGroup(group.rows);
    // Avoid colliding with a system column header of the same name.
    const sourceHeaders = sourceKeys.map((key) =>
      systemLabels.has(key) ? `Field: ${key}` : key
    );

    const headers = [...systemColumns.map((c) => c.label), ...sourceHeaders];
    const sheetRows = group.rows.map((job) => {
      const record: Record<string, string> = {};
      for (const col of systemColumns) {
        record[col.label] = col.get(job);
      }
      const fields = job.source_fields ?? {};
      sourceKeys.forEach((key, i) => {
        record[sourceHeaders[i]!] = fields[key] ?? '';
      });
      return record;
    });

    const worksheet = XLSX.utils.json_to_sheet(sheetRows, { header: headers });
    const label =
      singleSheet && opts.sheetName?.trim()
        ? opts.sheetName.trim()
        : group.sheetLabel;
    const sheetName = sanitizeSheetName(label, usedNames);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  const safeFile = opts.fileName
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.xlsx$/i, '');
  const fileBase = safeFile || `workwise-jobs-${formatTodayForFilename()}`;
  XLSX.writeFile(workbook, `${fileBase}.xlsx`);
}

function defaultExportName(): string {
  return `workwise-jobs-${formatTodayForFilename()}`;
}

export function ExportJobsButton({
  jobs,
  totalCount,
  filters,
  selectedIds = [],
}: ExportJobsButtonProps) {
  const selectedCount = selectedIds.length;
  const isDisabled = jobs.length === 0 && selectedCount === 0;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>(totalCount > jobs.length ? 'all' : 'page');
  const [customCount, setCustomCount] = useState(String(Math.min(totalCount, 100)));
  const [exportName, setExportName] = useState(defaultExportName);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    () => new Set(EXPORT_COLUMNS.map((c) => c.key))
  );
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (scope === 'selected' && selectedCount === 0) {
      setScope(totalCount > jobs.length ? 'all' : 'page');
    }
  }, [scope, selectedCount, totalCount, jobs.length]);

  const openDialog = () => {
    if (selectedCount > 0) setScope('selected');
    else setScope(totalCount > jobs.length ? 'all' : 'page');
    setExportName(defaultExportName());
    setOpen(true);
  };

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExport = async () => {
    if (selectedColumns.size === 0) {
      toast.error('Select at least one column to export.');
      return;
    }

    if (scope === 'selected' && selectedCount === 0) {
      toast.error('Select at least one job in the list first.');
      return;
    }

    setIsExporting(true);
    try {
      let rows: ExportableRow[];

      if (scope === 'page') {
        rows = jobs;
      } else if (scope === 'selected') {
        const result = await getJobsForExportAction(
          { ...filters, job_ids: selectedIds },
          { type: 'all' }
        );
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        // Preserve selection order as much as possible.
        const byId = new Map(result.jobs.map((j) => [j.id, j]));
        rows = selectedIds
          .map((id) => byId.get(id))
          .filter((j): j is ExportJobRow => !!j);
        if (result.capped) {
          toast.warning(`Export capped at ${EXPORT_MAX_ROWS.toLocaleString()} rows.`);
        }
      } else {
        const result = await getJobsForExportAction(
          filters,
          scope === 'all' ? { type: 'all' } : { type: 'count', count: Number(customCount) || 0 }
        );
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        rows = result.jobs;
        if (result.capped) {
          toast.warning(`Export capped at ${EXPORT_MAX_ROWS.toLocaleString()} rows.`);
        }
      }

      if (rows.length === 0) {
        toast.error('No jobs match this export.');
        return;
      }

      await buildAndDownloadWorkbook(rows, [...selectedColumns], {
        fileName: exportName,
        sheetName: exportName,
      });
      setOpen(false);
    } catch (err) {
      console.error('[ExportJobsButton] export failed', err);
      toast.error('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={isDisabled}
              onClick={openDialog}
            >
              <Download className="size-4" />
              Export
            </Button>
          </span>
        </TooltipTrigger>
        {isDisabled ? <TooltipContent>No jobs to export</TooltipContent> : null}
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export jobs</DialogTitle>
            <DialogDescription>
              Choose which jobs and WorkWise columns to include. Spreadsheet fields from
              each job are added automatically, with one sheet per customer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rows to export</Label>
              <div className="space-y-2 text-sm">
                <label
                  className={`flex items-center gap-2 ${selectedCount === 0 ? 'opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="export-scope"
                    className="border-border"
                    checked={scope === 'selected'}
                    disabled={selectedCount === 0}
                    onChange={() => setScope('selected')}
                  />
                  Selected ({selectedCount})
                  {selectedCount === 0 ? (
                    <span className="text-xs text-muted-foreground">— tick rows in the list</span>
                  ) : null}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="export-scope"
                    className="border-border"
                    checked={scope === 'page'}
                    onChange={() => setScope('page')}
                  />
                  Current page ({jobs.length})
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="export-scope"
                    className="border-border"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                  />
                  All matching filters ({totalCount.toLocaleString()}
                  {totalCount > EXPORT_MAX_ROWS
                    ? `, capped at ${EXPORT_MAX_ROWS.toLocaleString()}`
                    : ''}
                  )
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="export-scope"
                    className="border-border"
                    checked={scope === 'custom'}
                    onChange={() => setScope('custom')}
                  />
                  Custom amount
                </label>
                {scope === 'custom' && (
                  <Input
                    type="number"
                    min={1}
                    max={Math.min(totalCount, EXPORT_MAX_ROWS)}
                    value={customCount}
                    onChange={(e) => setCustomCount(e.target.value)}
                    className="ml-6 w-32"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="export-name">Sheet name</Label>
              <Input
                id="export-name"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder={defaultExportName()}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Used for the download filename. If the export is a single customer, this
                is also the Excel tab name; with multiple customers, each tab stays named
                after that customer.
              </p>
            </div>

            <div className="space-y-2">
              <Label>WorkWise columns</Label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {EXPORT_COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={selectedColumns.has(c.key)}
                      onChange={() => toggleColumn(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Each job’s spreadsheet fields are included automatically. The workbook uses
                one tab per customer so different layouts stay separate.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isExporting}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? <Loader2 className="size-4 animate-spin" /> : null}
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
