'use client';

import { MapPin, Calendar, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/jobs/copy-button';
import { cn } from '@/lib/utils';

interface JobDetailDetailsCardProps {
  address: string;
  postcode: string;
  description: string;
  scheduledDate: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export function JobDetailDetailsCard({
  address,
  postcode,
  description,
  scheduledDate,
  createdAt,
  updatedAt,
}: JobDetailDetailsCardProps) {
  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Job Details</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{address || '—'}</p>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-sm text-muted-foreground">{postcode || '—'}</span>
                <CopyButton value={postcode} label="Copy postcode" />
              </div>
            </div>
          </div>
        </div>

        {description && (
          <div>
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{description}</p>
            </div>
          </div>
        )}

        {scheduledDate && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="size-4 shrink-0" />
            <span>
              Scheduled: {format(new Date(scheduledDate), 'EEEE, MMM d, yyyy')}
            </span>
          </div>
        )}

        <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
          Created {format(new Date(createdAt), 'MMM d, yyyy HH:mm')}
          {updatedAt && (
            <> · Updated {format(new Date(updatedAt), 'MMM d, yyyy HH:mm')}</>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
