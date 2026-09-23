'use client';

import * as React from 'react';
import { Columns3 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { JOBS_LIST_COLUMNS, type JobsListColumnKey } from '@/lib/data/settings-types';

interface JobsColumnsPickerProps {
  visibleColumns: Set<JobsListColumnKey>;
  onToggle: (key: JobsListColumnKey) => void;
  /** When set, only these columns appear in the picker (portal hides office-only fields). */
  allowedColumns?: JobsListColumnKey[];
}

/**
 * "Which fields show as columns" — standard fields only (reference # and
 * the row-select checkbox are always on). Toggling is instant and purely
 * client-side; jobs-table persists the choice per account in the
 * background, it doesn't change what's fetched.
 */
export function JobsColumnsPicker({
  visibleColumns,
  onToggle,
  allowedColumns,
}: JobsColumnsPickerProps) {
  const columns = allowedColumns
    ? JOBS_LIST_COLUMNS.filter((c) => allowedColumns.includes(c.key))
    : JOBS_LIST_COLUMNS;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="size-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
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
      </PopoverContent>
    </Popover>
  );
}
