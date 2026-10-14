'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { visibleJobReportRows } from '@/lib/jobs/job-report-display';
import { JobReportRows } from '@/components/jobs/job-report-rows';

interface JobDetailJobReportCardProps {
  industryData: unknown;
  /** This business's `settings.job_report_fields`. */
  reportFields?: unknown;
}

export function JobDetailJobReportCard({ industryData, reportFields }: JobDetailJobReportCardProps) {
  const rows = visibleJobReportRows(industryData, reportFields);

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
        <JobReportRows rows={rows} />
      </CardContent>
    </Card>
  );
}
