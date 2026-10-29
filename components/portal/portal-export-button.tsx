'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { countPortalJobsAction, exportPortalJobsAction, type PortalExportRow } from '@/lib/actions/portal';
import type { JobsFilters, JobStatus } from '@/lib/data/jobs';
import { londonToday } from '@/lib/portal/dates';
import {
  choiceForStatuses,
  DATE_PRESET_LABELS,
  EXPORT_STATUSES,
  EXPORT_STATUS_LABELS,
  presetRange,
  rangeProblem,
  type DatePreset,
  type ExportStatusChoice,
} from '@/lib/portal/export';
import { cn } from '@/lib/utils';

const HEADERS: Array<[keyof PortalExportRow, string]> = [
  ['reference', 'Job ref'],
  ['address', 'Address'],
  ['postcode', 'Postcode'],
  ['work', 'Work requested'],
  ['status', 'Status'],
  ['booked', 'Booked for'],
  ['completed', 'Completed'],
  ['reason', 'Why it was not completed'],
];

function stamp(): string {
  return londonToday();
}

function onScreenStatuses(filters: JobsFilters): string[] {
  if (!filters.status) return [];
  return Array.isArray(filters.status) ? filters.status : [filters.status];
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        active ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Export the jobs as a spreadsheet. The window starts from what the table shows, lets the
 * customer change the dates and status, and says how many jobs they will get before they download.
 */
export function PortalExportButton({ filters, disabled }: { filters: JobsFilters; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(filters.date_from ?? '');
  const [to, setTo] = useState(filters.date_to ?? '');
  const screenStatuses = useMemo(() => onScreenStatuses(filters), [filters]);
  const [choice, setChoice] = useState<ExportStatusChoice>(() => choiceForStatuses(onScreenStatuses(filters)));
  const [count, setCount] = useState<number | null>(null);

  // Each time the window opens, start again from what the table is showing now.
  function openWindow() {
    setFrom(filters.date_from ?? '');
    setTo(filters.date_to ?? '');
    setChoice(choiceForStatuses(screenStatuses));
    setCount(null);
    setOpen(true);
  }

  const problem = rangeProblem(from, to);

  const exportFilters = useMemo<JobsFilters>(() => {
    const status: string[] | undefined =
      choice === 'all' ? undefined : choice === 'screen' ? screenStatuses : EXPORT_STATUSES[choice];
    return {
      ...filters,
      status: status as JobStatus[] | undefined,
      date_from: from || undefined,
      date_to: to || undefined,
    };
  }, [filters, choice, screenStatuses, from, to]);

  useEffect(() => {
    if (!open || problem) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const result = await countPortalJobsAction(exportFilters);
      if (!stale) setCount(result.success ? result.count : null);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, problem, exportFilters]);

  const otherFilters = Boolean(filters.search || filters.priority || (filters.field_filters?.length ?? 0) > 0 || filters.job_ids);

  function pick(preset: DatePreset) {
    const range = presetRange(preset, stamp());
    setCount(null);
    setFrom(range.from);
    setTo(range.to);
  }

  async function run() {
    setBusy(true);
    try {
      const result = await exportPortalJobsAction(exportFilters);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (result.rows.length === 0) {
        toast.error('No jobs match those choices.');
        return;
      }
      const XLSX = await import('xlsx');
      const sheetRows = result.rows.map((row) => Object.fromEntries(HEADERS.map(([key, label]) => [label, row[key]])));
      const sheet = XLSX.utils.json_to_sheet(sheetRows, { header: HEADERS.map(([, label]) => label) });
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Jobs');
      const provider = result.provider.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
      XLSX.writeFile(book, `Jobs with ${provider} ${stamp()}.xlsx`);
      setOpen(false);
    } catch (err) {
      console.error('[PortalExportButton]', err);
      toast.error('The export did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const statusChoices: ExportStatusChoice[] = ['all', 'completed', 'incomplete', 'todo', ...(choice === 'screen' ? (['screen'] as const) : [])];

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="gap-2" disabled={disabled} onClick={openWindow}>
        <Download className="size-4" />
        Export
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export jobs</DialogTitle>
            <DialogDescription>A spreadsheet of the jobs you choose, to check against invoices or share.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Booked between</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map((preset) => (
                  <Chip
                    key={preset}
                    active={(() => {
                      const range = presetRange(preset, stamp());
                      return range.from === from && range.to === to;
                    })()}
                    onClick={() => pick(preset)}
                  >
                    {DATE_PRESET_LABELS[preset]}
                  </Chip>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="export-from" className="text-xs text-muted-foreground">
                    From
                  </Label>
                  <Input
                    id="export-from"
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setCount(null);
                      setFrom(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="export-to" className="text-xs text-muted-foreground">
                    To
                  </Label>
                  <Input
                    id="export-to"
                    type="date"
                    value={to}
                    onChange={(e) => {
                      setCount(null);
                      setTo(e.target.value);
                    }}
                  />
                </div>
              </div>
              {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
            </div>

            <div className="space-y-2">
              <Label>Which jobs</Label>
              <div className="flex flex-wrap gap-2">
                {statusChoices.map((key) => (
                  <Chip
                    key={key}
                    active={choice === key}
                    onClick={() => {
                      setCount(null);
                      setChoice(key);
                    }}
                  >
                    {key === 'screen' ? 'As in the table' : EXPORT_STATUS_LABELS[key]}
                  </Chip>
                ))}
              </div>
            </div>

            {otherFilters ? (
              <p className="text-sm text-muted-foreground">Your search and other filters in the table are also applied.</p>
            ) : null}

            <p className="text-sm font-medium" aria-live="polite">
              {problem ? '' : count == null ? 'Counting jobs…' : `${count} ${count === 1 ? 'job' : 'jobs'} will be exported`}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" className="gap-2" disabled={busy || Boolean(problem) || count === 0} onClick={() => void run()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Download spreadsheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
