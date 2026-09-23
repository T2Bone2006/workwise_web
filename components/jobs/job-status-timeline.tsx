'use client';

import { format, isValid } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function formatTimelineAt(iso: string): string {
  const d = new Date(iso);
  if (!isValid(d)) return iso;
  // Same absolute style as Created/Updated on the job details card.
  return format(d, 'MMM d, yyyy HH:mm');
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  pending_send: 'Ready to send',
  assigned: 'Assigned',
  in_progress: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  incomplete: 'Not completed',
  cancelled: 'Cancelled',
  declined: 'Declined',
};

const STATUS_DOT_CLASS: Record<string, string> = {
  pending: 'bg-slate-400 shadow-[0_0_8px_rgba(100,116,139,0.35)]',
  pending_send: 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.45)]',
  assigned: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]',
  in_progress: 'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.4)]',
  paused: 'bg-amber-300 shadow-[0_0_8px_rgba(180,83,9,0.35)]',
  completed: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]',
  incomplete: 'bg-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.4)]',
  cancelled: 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.3)]',
  declined: 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.3)]',
};

export interface JobStatusHistoryEntry {
  id: string;
  to_status: string;
  from_status: string | null;
  created_at: string;
  changed_by_user_id: string | null;
  changed_by_worker_id: string | null;
  notes: string | null;
  metadata?: Record<string, unknown> | null;
}

function declineReason(entry: JobStatusHistoryEntry): string | null {
  const reason = entry.metadata?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}

interface JobStatusTimelineProps {
  entries: JobStatusHistoryEntry[];
  /** When false, hide the User / Worker / System line (customer portal). */
  showActor?: boolean;
}

function changedByLabel(entry: JobStatusHistoryEntry): string {
  if (entry.notes?.toLowerCase().includes('assign')) return entry.notes;
  if (entry.changed_by_user_id) return 'User';
  if (entry.changed_by_worker_id) return 'Worker';
  return 'System';
}

export function JobStatusTimeline({ entries, showActor = true }: JobStatusTimelineProps) {
  if (entries.length === 0) {
    return (
      <Card className="overflow-hidden border border-border/80 bg-card shadow-sm dark:border-white/[0.08]">
        <CardHeader className="pb-3">
          <h2 className="text-base font-semibold text-foreground">Status History</h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No status changes yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border border-border/80 bg-card shadow-sm transition-all duration-300 dark:border-white/[0.08]">
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Status History</h2>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div
            className="absolute bottom-2 left-[11px] top-2 w-px bg-gradient-to-b from-primary/30 via-border to-transparent"
            aria-hidden
          />
          <ul className="space-y-0">
            {entries.map((entry, i) => (
              <li
                key={entry.id}
                className="relative flex gap-4 pb-5 last:pb-0 animate-in fade-in slide-in-from-left-2 duration-300"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div
                  className={cn(
                    'relative z-10 mt-1.5 size-[22px] shrink-0 rounded-full border-2 border-background',
                    STATUS_DOT_CLASS[entry.to_status] ?? 'bg-muted-foreground/50'
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {entry.from_status != null
                      ? `${STATUS_LABELS[entry.from_status] ?? entry.from_status} → ${STATUS_LABELS[entry.to_status] ?? entry.to_status}`
                      : (STATUS_LABELS[entry.to_status] ?? entry.to_status)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatTimelineAt(entry.created_at)}
                  </p>
                  {showActor ? (
                    <p className="mt-0.5 text-xs text-muted-foreground/80">
                      {changedByLabel(entry)}
                    </p>
                  ) : null}
                  {declineReason(entry) && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      &ldquo;{declineReason(entry)}&rdquo;
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
