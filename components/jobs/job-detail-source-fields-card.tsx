'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type JobDetailSourceFieldsCardProps = {
  sourceFields: Record<string, string>;
};

export function JobDetailSourceFieldsCard({ sourceFields }: JobDetailSourceFieldsCardProps) {
  const entries = Object.entries(sourceFields).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  if (entries.length === 0) return null;

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sheet fields</CardTitle>
        <CardDescription>
          Spreadsheet columns kept with this job. Search and filter by any of these
          values.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([key, value]) => (
            <span
              key={key}
              title={`${key}: ${value}`}
              className="inline-flex max-w-full rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
            >
              <span className="truncate">
                <span className="font-medium text-foreground/80">{key}:</span> {value}
              </span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
