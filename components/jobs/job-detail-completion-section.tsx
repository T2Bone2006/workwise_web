'use client';

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { JobAttachmentPhotoGrids } from '@/components/jobs/job-detail-photos-card';
import type { JobAttachmentRow } from '@/lib/utils/job-attachments';
import {
  formatIndustryDateTime,
  formatIndustryYesNo,
  nonEmptyString,
  parseJobIndustryData,
  walkedAwayFromIndustry,
  type JobIndustryData,
} from '@/lib/utils/job-industry-data';

interface JobDetailCompletionSectionProps {
  completedAt: string | null;
  industryData: unknown;
  completionNotes?: string;
  jobPhotos?: { before: JobAttachmentRow[]; after: JobAttachmentRow[] };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function JobDetailCompletionSection({
  completedAt,
  industryData,
  completionNotes,
  jobPhotos,
}: JobDetailCompletionSectionProps) {
  const data: JobIndustryData = parseJobIndustryData(industryData);
  const walkedAway = walkedAwayFromIndustry(data);
  const notesTrimmed = (completionNotes ?? '').trim();
  const before = jobPhotos?.before ?? [];
  const after = jobPhotos?.after ?? [];
  const hasPhotos = before.length > 0 || after.length > 0;

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Completion</h2>
        {formatIndustryDateTime(completedAt) != null && (
          <CardDescription>Completed {formatIndustryDateTime(completedAt)}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Completion notes</h3>
          {notesTrimmed.length > 0 ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{notesTrimmed}</p>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>

        <dl className="space-y-3">
          <Row label="Lock changed" value={formatIndustryYesNo(data.lock_changed)} />
          <Row
            label="Walked away"
            value={formatIndustryYesNo(data.walked_away ?? data.walk_away)}
          />
          {walkedAway === true && (
            <>
              {nonEmptyString(data.walk_away_reason) != null && (
                <Row label="Walk-away reason" value={nonEmptyString(data.walk_away_reason)!} />
              )}
              {nonEmptyString(data.walk_away_detail) != null && (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Walk-away detail</dt>
                  <dd className="whitespace-pre-wrap text-sm text-foreground">
                    {nonEmptyString(data.walk_away_detail)}
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>

        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Before and after photos</h3>
          {hasPhotos ? (
            <JobAttachmentPhotoGrids beforePhotos={before} afterPhotos={after} />
          ) : (
            <p className="text-sm text-muted-foreground">No photos uploaded for this job.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
