'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  formatIndustryDateTime,
  formatIndustryYesNo,
  nonEmptyString,
  parseJobIndustryData,
  walkedAwayFromIndustry,
  type JobIndustryData,
} from '@/lib/utils/job-industry-data';

interface JobDetailJobReportCardProps {
  industryData: unknown;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function JobDetailJobReportCard({ industryData }: JobDetailJobReportCardProps) {
  const data: JobIndustryData = parseJobIndustryData(industryData);
  const walkedAway = walkedAwayFromIndustry(data);

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Job Report</h2>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3">
          <Row label="Lock changed" value={formatIndustryYesNo(data.lock_changed)} />
          <Row label="Walked away" value={formatIndustryYesNo(data.walked_away ?? data.walk_away)} />
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
          {(formatIndustryDateTime(data.start_time) != null ||
            formatIndustryDateTime(data.end_time) != null) && (
            <>
              {formatIndustryDateTime(data.start_time) != null && (
                <Row label="Start time" value={formatIndustryDateTime(data.start_time)!} />
              )}
              {formatIndustryDateTime(data.end_time) != null && (
                <Row label="End time" value={formatIndustryDateTime(data.end_time)!} />
              )}
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
