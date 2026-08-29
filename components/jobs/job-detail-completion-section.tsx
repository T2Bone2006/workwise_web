'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardAction, CardContent, CardHeader } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';
import { updateJobCompletionRecord } from '@/lib/actions/jobs';
import { JobAttachmentPhotoGrids } from '@/components/jobs/job-detail-photos-card';
import type { JobAttachmentRow } from '@/lib/utils/job-attachments';
import {
  formatIndustryDateTime,
  formatIndustryYesNo,
  nonEmptyString,
  parseJobIndustryData,
  triStateYesNo,
  walkedAwayFromIndustry,
  type JobIndustryData,
} from '@/lib/utils/job-industry-data';

interface JobDetailCompletionSectionProps {
  jobId: string;
  completedAt: string | null;
  industryData: unknown;
  completionNotes?: string;
  jobPhotos?: { before: JobAttachmentRow[]; after: JobAttachmentRow[] };
}

type TriState = 'yes' | 'no' | 'unset';

function toTriState(v: 'Yes' | 'No' | null): TriState {
  return v === 'Yes' ? 'yes' : v === 'No' ? 'no' : 'unset';
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
  jobId,
  completedAt,
  industryData,
  completionNotes,
  jobPhotos,
}: JobDetailCompletionSectionProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [displayed, setDisplayed] = useState({
    notes: (completionNotes ?? '').trim(),
    data: parseJobIndustryData(industryData),
  });

  const [draft, setDraft] = useState(() => makeDraft(displayed.notes, displayed.data));

  function makeDraft(notes: string, data: JobIndustryData) {
    return {
      notes,
      lockChanged: toTriState(triStateYesNo(data.lock_changed)),
      walkedAway: toTriState(triStateYesNo(data.walked_away ?? data.walk_away)),
      walkAwayReason: nonEmptyString(data.walk_away_reason) ?? '',
      walkAwayDetail: nonEmptyString(data.walk_away_detail) ?? '',
    };
  }

  function startEditing() {
    setDraft(makeDraft(displayed.notes, displayed.data));
    setIsEditing(true);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const result = await updateJobCompletionRecord({
        jobId,
        completion_notes: draft.notes,
        lock_changed: draft.lockChanged,
        walked_away: draft.walkedAway,
        walk_away_reason: draft.walkAwayReason,
        walk_away_detail: draft.walkAwayDetail,
      });
      if (result.success) {
        setDisplayed({
          notes: result.completionNotes,
          data: parseJobIndustryData(result.industryData),
        });
        toast.success('Completion record updated');
        setIsEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to update completion record');
    } finally {
      setIsSaving(false);
    }
  }

  const walkedAway = walkedAwayFromIndustry(displayed.data);
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
          <p className="text-sm text-muted-foreground">
            Completed {formatIndustryDateTime(completedAt)}
          </p>
        )}
        <CardAction>
          {isEditing ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setIsEditing(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="xs" onClick={startEditing}>
              Edit
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="completion-edit-notes">Completion notes</Label>
              <Textarea
                id="completion-edit-notes"
                rows={4}
                className="resize-y min-h-[100px]"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Lock changed</Label>
                <Select
                  value={draft.lockChanged}
                  onValueChange={(v) => setDraft((d) => ({ ...d, lockChanged: v as TriState }))}
                  disabled={isSaving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not set</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Walked away</Label>
                <Select
                  value={draft.walkedAway}
                  onValueChange={(v) => setDraft((d) => ({ ...d, walkedAway: v as TriState }))}
                  disabled={isSaving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not set</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="completion-edit-reason">Walk-away reason</Label>
              <Input
                id="completion-edit-reason"
                value={draft.walkAwayReason}
                onChange={(e) => setDraft((d) => ({ ...d, walkAwayReason: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="completion-edit-detail">Walk-away detail</Label>
              <Textarea
                id="completion-edit-detail"
                rows={3}
                className="resize-y min-h-[80px]"
                value={draft.walkAwayDetail}
                onChange={(e) => setDraft((d) => ({ ...d, walkAwayDetail: e.target.value }))}
                disabled={isSaving}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
              >
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
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Completion notes</h3>
              {displayed.notes.length > 0 ? (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {displayed.notes}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>

            <dl className="space-y-3">
              <Row label="Lock changed" value={formatIndustryYesNo(displayed.data.lock_changed)} />
              <Row
                label="Walked away"
                value={formatIndustryYesNo(displayed.data.walked_away ?? displayed.data.walk_away)}
              />
              {walkedAway === true && (
                <>
                  {nonEmptyString(displayed.data.walk_away_reason) != null && (
                    <Row
                      label="Walk-away reason"
                      value={nonEmptyString(displayed.data.walk_away_reason)!}
                    />
                  )}
                  {nonEmptyString(displayed.data.walk_away_detail) != null && (
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">
                        Walk-away detail
                      </dt>
                      <dd className="whitespace-pre-wrap text-sm text-foreground">
                        {nonEmptyString(displayed.data.walk_away_detail)}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
