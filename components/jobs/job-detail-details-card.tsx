'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Calendar, FileText, CalendarIcon, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Card, CardAction, CardContent, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/jobs/copy-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { formatTimeRangeOrLength } from '@/lib/jobs/format-job-time';
import { updateJobDetails } from '@/lib/actions/jobs';
import type { JobPriority } from '@/lib/data/jobs';
import { cn } from '@/lib/utils';

const PRIORITY_OPTIONS: Array<{ value: JobPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'emergency', label: 'Urgent' },
];

const PRIORITY_BADGE_CLASS: Record<JobPriority, string> = {
  low: 'border-slate-400/60 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  normal: 'border-blue-400/60 bg-blue-500/10 text-blue-800 dark:text-blue-300',
  high: 'border-amber-400/60 bg-amber-500/10 text-amber-900 dark:text-amber-300',
  emergency: 'border-red-400/60 bg-red-500/10 text-red-900 dark:text-red-300',
};

const JOB_LENGTH_OPTIONS = [
  { value: 'half_day', label: 'Half day' },
  { value: 'full_day', label: 'Full day' },
] as const;

interface JobDetailDetailsCardProps {
  jobId: string;
  address: string;
  postcode: string;
  description: string;
  priority: JobPriority;
  scheduledDate: string | null;
  startTime?: string | null;
  endTime?: string | null;
  jobLength?: 'half_day' | 'full_day' | null;
  createdAt: string;
  updatedAt: string | null;
  /** Locked on a network-origin view — the receiving business owns these fields now. */
  readOnly?: boolean;
}

interface EditState {
  address: string;
  postcode: string;
  description: string;
  priority: JobPriority;
  jobLength: 'half_day' | 'full_day' | '__unset__';
  scheduledDate: string; // yyyy-MM-dd, '' for unset
  startTime: string;
  endTime: string;
}

export function JobDetailDetailsCard({
  jobId,
  address,
  postcode,
  description,
  priority,
  scheduledDate,
  startTime,
  endTime,
  jobLength,
  createdAt,
  updatedAt,
  readOnly = false,
}: JobDetailDetailsCardProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [displayed, setDisplayed] = useState({
    address,
    postcode,
    description,
    priority,
    scheduledDate,
    startTime: startTime ?? null,
    endTime: endTime ?? null,
    jobLength: jobLength ?? null,
    updatedAt,
  });
  const [draft, setDraft] = useState<EditState>(() => toDraft(displayed));

  function toDraft(d: typeof displayed): EditState {
    return {
      address: d.address,
      postcode: d.postcode,
      description: d.description,
      priority: d.priority,
      jobLength: d.jobLength ?? '__unset__',
      scheduledDate: d.scheduledDate ?? '',
      startTime: d.startTime ?? '',
      endTime: d.endTime ?? '',
    };
  }

  function startEditing() {
    setDraft(toDraft(displayed));
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const result = await updateJobDetails({
        jobId,
        address: draft.address,
        postcode: draft.postcode,
        description: draft.description,
        priority: draft.priority,
        job_length: draft.jobLength === '__unset__' ? undefined : draft.jobLength,
        scheduled_date: draft.scheduledDate || undefined,
        scheduled_time: draft.startTime || undefined,
        end_time: draft.endTime || undefined,
      });
      if (result.success) {
        setDisplayed({
          address: result.job.address,
          postcode: result.job.postcode,
          description: result.job.description,
          priority: result.job.priority,
          scheduledDate: result.job.scheduled_date,
          startTime: result.job.scheduled_time,
          endTime: result.job.end_time,
          jobLength: result.job.job_length,
          updatedAt: new Date().toISOString(),
        });
        toast.success('Job details updated');
        setIsEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to update job details');
    } finally {
      setIsSaving(false);
    }
  }

  const timeLabel = formatTimeRangeOrLength(displayed.startTime, displayed.endTime, displayed.jobLength);
  const scheduledDateObj = draft.scheduledDate
    ? new Date(`${draft.scheduledDate}T00:00:00`)
    : undefined;

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Job Details</h2>
        {!readOnly && (
          <CardAction>
            {isEditing ? (
              <Button type="button" variant="ghost" size="xs" onClick={cancelEditing} disabled={isSaving}>
                Cancel
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="xs" onClick={startEditing}>
                Edit
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="job-edit-address">Address</Label>
              <Input
                id="job-edit-address"
                value={draft.address}
                onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-edit-postcode">Postcode</Label>
              <Input
                id="job-edit-postcode"
                className="uppercase"
                value={draft.postcode}
                onChange={(e) => setDraft((d) => ({ ...d, postcode: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-edit-description">Description</Label>
              <Textarea
                id="job-edit-description"
                rows={4}
                className="resize-y min-h-[100px]"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={draft.priority}
                  onValueChange={(v) => setDraft((d) => ({ ...d, priority: v as JobPriority }))}
                  disabled={isSaving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium',
                            PRIORITY_BADGE_CLASS[o.value]
                          )}
                        >
                          {o.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Job length</Label>
                <Select
                  value={draft.jobLength}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, jobLength: v as EditState['jobLength'] }))
                  }
                  disabled={isSaving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset__">Not specified</SelectItem>
                    {JOB_LENGTH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Scheduled date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSaving}
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !draft.scheduledDate && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 size-4 shrink-0" />
                      {draft.scheduledDate ? format(scheduledDateObj!, 'd MMM yyyy') : 'Not set'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={scheduledDateObj}
                      onSelect={(date) =>
                        setDraft((d) => ({
                          ...d,
                          scheduledDate: date ? format(date, 'yyyy-MM-dd') : '',
                        }))
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-edit-start">Start time</Label>
                <Input
                  id="job-edit-start"
                  type="time"
                  value={draft.startTime}
                  onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))}
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="job-edit-end">Finish time</Label>
                <Input
                  id="job-edit-end"
                  type="time"
                  value={draft.endTime}
                  onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))}
                  disabled={isSaving}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
              <Button type="button" variant="outline" size="sm" onClick={cancelEditing} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <span
              className={cn(
                'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium',
                PRIORITY_BADGE_CLASS[displayed.priority]
              )}
            >
              {PRIORITY_OPTIONS.find((o) => o.value === displayed.priority)?.label ??
                displayed.priority}
            </span>
            <div>
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words text-foreground">
                    {displayed.address || '—'}
                  </p>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">{displayed.postcode || '—'}</span>
                    <CopyButton value={displayed.postcode} label="Copy postcode" />
                  </div>
                </div>
              </div>
            </div>

            {displayed.description && (
              <div>
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p className="break-words text-sm whitespace-pre-wrap text-muted-foreground">
                    {displayed.description}
                  </p>
                </div>
              </div>
            )}

            {(displayed.scheduledDate || timeLabel) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="size-4 shrink-0" />
                <span>
                  Scheduled:{' '}
                  {displayed.scheduledDate
                    ? format(new Date(displayed.scheduledDate), 'EEEE, MMM d, yyyy')
                    : 'date not set'}
                  {timeLabel && ` · ${timeLabel}`}
                </span>
              </div>
            )}

            <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
              Created {format(new Date(createdAt), 'MMM d, yyyy HH:mm')}
              {displayed.updatedAt && (
                <> · Updated {format(new Date(displayed.updatedAt), 'MMM d, yyyy HH:mm')}</>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
