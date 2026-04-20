'use client';

import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  pending_send: 'Ready to send',
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_DOT_CLASS: Record<string, string> = {
  pending: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]',
  pending_send: 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.45)]',
  assigned: 'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.4)]',
  in_progress: 'bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.4)]',
  completed: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]',
  cancelled: 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.3)]',
};

export interface JobStatusHistoryEntry {
  id: string;
  to_status: string;
  from_status: string | null;
  created_at: string;
  changed_by_user_id: string | null;
  changed_by_worker_id: string | null;
  notes: string | null;
}

interface JobStatusTimelineProps {
  entries: JobStatusHistoryEntry[];
}

function changedByLabel(entry: JobStatusHistoryEntry): string {
  if (entry.notes?.toLowerCase().includes('assign')) return entry.notes;
  if (entry.changed_by_user_id) return 'User';
  if (entry.changed_by_worker_id) return 'Worker';
  return 'System';
}

export function JobStatusTimeline({ entries }: JobStatusTimelineProps) {
  if (entries.length === 0) {
    return (
      <Card
        className={cn(
          'glass-card overflow-hidden border-border/80',
          'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
        )}
      >
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
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Status History</h2>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div
            className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/30 via-border to-transparent"
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
                    {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground/80">
                    {changedByLabel(entry)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
