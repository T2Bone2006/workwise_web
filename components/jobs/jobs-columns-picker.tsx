'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, Columns3, Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  JOBS_LIST_COLUMNS,
  type JobsListColumnId,
  type JobsListColumnKey,
} from '@/lib/data/settings-types';
import type { FieldGroup } from '@/lib/jobs/field-groups';
import { fieldLabelFromHeader } from '@/lib/jobs/worker-visible-fields';

interface JobsColumnsPickerProps {
  visibleColumns: Set<JobsListColumnId>;
  onToggle: (key: JobsListColumnId) => void;
  /** When set, only these columns appear in the picker (portal hides office-only fields). */
  allowedColumns?: JobsListColumnKey[];
  /** The business's named fields. Offered as columns under "Your fields". */
  fieldGroups?: FieldGroup[];
  /**
   * Spreadsheet columns nobody has put in a field yet. `undefined` = the
   * feature isn't offered here; `null` = not loaded yet.
   */
  otherHeaders?: string[] | null;
  /** Called when the popover opens, so the owner of the list can fetch `otherHeaders`. */
  onOpen?: () => void;
  /**
   * Spreadsheet headers on this customer's imported jobs. Listed under the
   * standard columns. The portal has no named fields and no Settings page.
   */
  importHeaders?: string[];
}

/**
 * "Which fields show as columns". Standard fields first, then the business's
 * named fields, then (tucked away) every spreadsheet column that isn't in a
 * field yet. Toggling is instant and purely client-side; jobs-table persists
 * the choice per account in the background, it doesn't change what's fetched.
 */
export function JobsColumnsPicker({
  visibleColumns,
  onToggle,
  allowedColumns,
  fieldGroups = [],
  otherHeaders,
  onOpen,
  importHeaders = [],
}: JobsColumnsPickerProps) {
  const columns = allowedColumns
    ? JOBS_LIST_COLUMNS.filter((c) => allowedColumns.includes(c.key))
    : JOBS_LIST_COLUMNS;
  const [showOther, setShowOther] = React.useState(false);
  const offersFields = otherHeaders !== undefined;

  // A raw column someone switched on stays listed even after it joins a field.
  const pickedOther = [...visibleColumns]
    .filter((c) => c.startsWith('sf:'))
    .map((c) => c.slice(3));
  const otherList = [...new Set([...(otherHeaders ?? []), ...pickedOther])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  return (
    <Popover onOpenChange={(open) => open && onOpen?.()}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="size-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-64 overflow-y-auto p-2">
        <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Show columns</p>
        <div className="flex flex-col">
          {columns.map((column) => (
            <label
              key={column.key}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={visibleColumns.has(column.key)}
                onCheckedChange={() => onToggle(column.key)}
              />
              {column.label}
            </label>
          ))}
        </div>

        {importHeaders.length > 0 && (
          <>
            <p className="mt-2 border-t border-border/60 px-1 pb-1.5 pt-2 text-xs font-medium text-muted-foreground">
              From imports
            </p>
            <div className="flex flex-col">
              {importHeaders.map((header) => {
                const id = `sf:${header}` as JobsListColumnId;
                const label = fieldLabelFromHeader(header) || header;
                return (
                  <label
                    key={header}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={visibleColumns.has(id)}
                      onCheckedChange={() => onToggle(id)}
                    />
                    <span className="truncate" title={header}>
                      {label}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {offersFields && (
          <>
            <p className="mt-2 border-t border-border/60 px-1 pb-1.5 pt-2 text-xs font-medium text-muted-foreground">
              Your fields
            </p>
            {fieldGroups.length > 0 ? (
              <div className="flex flex-col">
                {fieldGroups.map((group) => {
                  const id: JobsListColumnId = `fg:${group.id}`;
                  return (
                    <label
                      key={group.id}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={visibleColumns.has(id)}
                        onCheckedChange={() => onToggle(id)}
                      />
                      <span className="truncate">{group.name}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="px-1 pb-1 text-xs text-muted-foreground">
                None yet. A field bundles spreadsheet columns that mean the same thing.
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowOther((v) => !v)}
              className="mt-1 flex w-full items-center justify-between rounded-sm px-1 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
              aria-expanded={showOther}
            >
              <span>
                Other columns
                {otherHeaders === null ? '' : ` (${otherList.length})`}
              </span>
              <ChevronDown className={`size-3.5 transition-transform ${showOther ? 'rotate-180' : ''}`} />
            </button>
            {showOther &&
              (otherHeaders === null && otherList.length === 0 ? (
                <p className="px-1 py-1 text-xs text-muted-foreground">Loading…</p>
              ) : otherList.length === 0 ? (
                <p className="px-1 py-1 text-xs text-muted-foreground">
                  Every spreadsheet column is in a field.
                </p>
              ) : (
                <div className="flex max-h-48 flex-col overflow-y-auto">
                  {otherList.map((header) => {
                    const id = `sf:${header}` as JobsListColumnId;
                    return (
                      <label
                        key={header}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-sm hover:bg-accent"
                      >
                        <Checkbox
                          checked={visibleColumns.has(id)}
                          onCheckedChange={() => onToggle(id)}
                        />
                        <span className="truncate" title={header}>
                          {header}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}

            <Link
              href="/settings"
              className="mt-2 flex items-center gap-1.5 border-t border-border/60 px-1 pt-2 text-xs font-medium text-primary hover:underline"
            >
              <Settings2 className="size-3.5" />
              Manage fields in Settings
            </Link>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
