'use client';

import { useMemo } from 'react';
import { Group, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeRowGroups, countGroupedRows } from '@/lib/import/job-grouping';
import type { GroupingSuggestion } from '@/lib/import/suggest-grouping-columns';

/** Groups listed in the preview before "and N more". */
const PREVIEW_GROUP_LIMIT = 6;

interface ImportGroupingPanelProps {
  headers: string[];
  rows: Record<string, string>[];
  /** Rows that will actually be imported (validated). Preview only counts these. */
  importableRowIndexes: number[];
  selectedColumns: string[];
  onChange: (columns: string[]) => void;
  suggestion: GroupingSuggestion | null;
  isSuggesting: boolean;
  disabled?: boolean;
}

/**
 * Review-step control for import-time job grouping: which sheet columns
 * define a group, with a live preview of the groups that would be created.
 */
export function ImportGroupingPanel({
  headers,
  rows,
  importableRowIndexes,
  selectedColumns,
  onChange,
  suggestion,
  isSuggesting,
  disabled = false,
}: ImportGroupingPanelProps) {
  const groups = useMemo(
    () => computeRowGroups(rows, selectedColumns, importableRowIndexes),
    [rows, selectedColumns, importableRowIndexes]
  );
  const groupedRows = countGroupedRows(groups);
  const enabled = selectedColumns.length > 0;

  const toggleColumn = (header: string) => {
    if (selectedColumns.includes(header)) {
      onChange(selectedColumns.filter((c) => c !== header));
    } else {
      // Keep sheet order so the label reads left-to-right like the row.
      onChange(headers.filter((h) => h === header || selectedColumns.includes(h)));
    }
  };

  const suggestionNote = (() => {
    if (isSuggesting) return 'Checking whether rows in this sheet belong together…';
    if (!suggestion) return null;
    if (suggestion.source === 'saved') {
      return suggestion.columns.length > 0
        ? 'Using the grouping you chose last time for this customer.'
        : 'Grouping was switched off for this customer last time.';
    }
    if (suggestion.source === 'ai') {
      return suggestion.reason ?? 'Suggested from the sheet contents.';
    }
    return 'Pick which columns mean these jobs travel together for this customer — or leave grouping off.';
  })();

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-medium">
        <Group className="size-4 text-primary" />
        Group jobs that go together
      </legend>
      <p className="text-sm text-muted-foreground">
        Rows with the same values in every ticked column become one group (e.g. same
        officer and date, or same address), assigned to a single worker. Your choice is
        remembered for this customer.
      </p>

      {suggestionNote && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {isSuggesting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : suggestion?.source === 'ai' ? (
            <Sparkles className="size-3.5 text-primary" />
          ) : null}
          {suggestionNote}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {headers.map((header) => {
          const on = selectedColumns.includes(header);
          return (
            <button
              key={header}
              type="button"
              disabled={disabled}
              onClick={() => toggleColumn(header)}
              aria-pressed={on}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                on
                  ? 'border-primary bg-primary/10 font-medium text-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-60'
              )}
            >
              {header}
            </button>
          );
        })}
      </div>

      {enabled ? (
        groups.length > 0 ? (
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {groups.length} group{groups.length === 1 ? '' : 's'} · {groupedRows} of{' '}
              {importableRowIndexes.length} jobs grouped
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
              {groups.slice(0, PREVIEW_GROUP_LIMIT).map((g) => (
                <li key={g.key} className="truncate">
                  <span className="text-foreground">{g.label}</span> — {g.rowIndexes.length} jobs
                </li>
              ))}
              {groups.length > PREVIEW_GROUP_LIMIT && (
                <li>and {groups.length - PREVIEW_GROUP_LIMIT} more</li>
              )}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            No two rows share the same values in those columns, so no groups would be created.
          </p>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          Grouping is off — every row imports as an independent job.
        </p>
      )}
    </fieldset>
  );
}
