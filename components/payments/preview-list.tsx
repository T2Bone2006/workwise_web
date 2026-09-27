'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const PREVIEW = 5;

/** Shows the first few rows, then a bottom sheet with the full list. */
export function PreviewList({
  title,
  items,
  preview = PREVIEW,
}: {
  title: string;
  items: ReactNode[];
  preview?: number;
}) {
  const [open, setOpen] = useState(false);
  const count = items.length;
  if (count === 0) return null;
  const head = items.slice(0, preview);
  const hasMore = count > preview;

  function renderRows(rows: ReactNode[]) {
    return (
      <ul className="overflow-hidden rounded-lg border border-border/70">
        {rows.map((item, index) => (
          <li
            key={index}
            className={cn(
              'border-b border-border/50 px-3 py-2.5 last:border-b-0',
              index % 2 === 1 && 'bg-muted/45',
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{title}</p>
      {renderRows(head)}
      {hasMore ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 text-sm"
            onClick={() => setOpen(true)}
          >
            View all {count}
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[85vh] overflow-y-auto rounded-t-xl"
            >
              <SheetHeader>
                <SheetTitle>
                  {title} ({count})
                </SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-6">{renderRows(items)}</div>
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
