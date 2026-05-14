'use client';

import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { JobRow } from '@/lib/data/jobs';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';

interface ExportJobsButtonProps {
  jobs: JobRow[];
}

type ExportableJob = JobRow & {
  started_at?: string | null;
  arrived_at?: string | null;
  completed_at?: string | null;
  completion_notes?: string | null;
};

function formatDateForExport(value: string | null | undefined): string {
  if (!value) return '';

  const source = value.length <= 10 ? `${value}T12:00:00` : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

function formatDateTimeForExport(value: string | null | undefined): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function formatTodayForFilename(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ExportJobsButton({ jobs }: ExportJobsButtonProps) {
  const isDisabled = jobs.length === 0;

  const handleExport = () => {
    if (isDisabled) return;

    const rows = jobs.map((job) => {
      const enrichedJob = job as ExportableJob;
      return {
        'Job Ref': job.reference_number ?? '',
        Customer: job.customer_name ?? '',
        Address: job.address ?? '',
        Postcode: job.postcode ?? '',
        'Job Type': job.job_description ?? '',
        Status: job.status ? (JOB_STATUS_DISPLAY[job.status]?.label ?? job.status) : '',
        'Assigned To': job.worker_name ?? 'Unassigned',
        'Scheduled Date': formatDateForExport(job.scheduled_date),
        'Start Time': formatDateTimeForExport(enrichedJob.started_at ?? enrichedJob.arrived_at),
        'Completion Date & Time': formatDateTimeForExport(enrichedJob.completed_at),
        'Completion Notes': enrichedJob.completion_notes ?? '',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: [
        'Job Ref',
        'Customer',
        'Address',
        'Postcode',
        'Job Type',
        'Status',
        'Assigned To',
        'Scheduled Date',
        'Start Time',
        'Completion Date & Time',
        'Completion Notes',
      ],
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Jobs');
    XLSX.writeFile(workbook, `workwise-jobs-${formatTodayForFilename()}.xlsx`);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={isDisabled}
            onClick={handleExport}
          >
            <Download className="size-4" />
            Export
          </Button>
        </span>
      </TooltipTrigger>
      {isDisabled ? <TooltipContent>No jobs to export</TooltipContent> : null}
    </Tooltip>
  );
}
