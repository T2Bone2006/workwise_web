'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { bulkAssignJobs } from '@/lib/actions/jobs';
import { placeProJobs } from '@/lib/actions/pro-calendar';
import { statusAfterWorkerAssignment } from '@/lib/jobs/worker-assignment-status';
import { firstName, flattenDay, mergeJobs, type CalendarWorker, type ProCalendarJob } from '@/lib/jobs/pro-calendar';
import { formatBoardDay } from '@/lib/rounds/week-board';
import type { Ymd } from '@/lib/rounds/dates';
import { signatureOf } from './calendar-dnd';

function jobsWord(n: number): string {
  return n === 1 ? 'the job' : `${n} jobs`;
}

/**
 * The calendar's jobs, kept in the browser so a move or a hand-over shows at once. Every change is saved straight
 * away; if saving fails the jobs go back where they were and a message says why. One change at a time.
 *
 * `window` is the dates the page itself loaded: a fresh page replaces just those (and the jobs with no date), so
 * weeks the board loaded by scrolling are kept.
 */
export function useCalendarJobs(incoming: ProCalendarJob[], window: { from: Ymd; to: Ymd }) {
  const router = useRouter();
  const signature = signatureOf(incoming);
  const [jobs, setJobsState] = useState(incoming);
  const [saving, setSavingState] = useState(false);
  // A drop into someone's lane gives and then places in one go, so each step reads what the last one left.
  const current = useRef(incoming);
  const busy = useRef(false);

  const setJobs = (next: ProCalendarJob[]) => {
    current.current = next;
    setJobsState(next);
  };
  const setSaving = (next: boolean) => {
    busy.current = next;
    setSavingState(next);
  };

  useEffect(() => {
    setJobs(mergeJobs(current.current, incoming, { from: window.from, to: window.to, undated: true }));
    // A fresh server render with the same jobs must not wipe a change that has not come back yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /** Jobs the board loaded for more weeks. */
  const merge = (fresh: ProCalendarJob[], from: Ymd, to: Ymd) => {
    setJobs(mergeJobs(current.current, fresh, { from, to, undated: false }));
  };

  const undoMove = async (before: ProCalendarJob[], days: Map<Ymd | null, string[]>) => {
    if (busy.current) return;
    setJobs(before);
    setSaving(true);
    for (const [date, ids] of days) {
      const result = await placeProJobs(date, ids);
      if (!result.success) {
        setSaving(false);
        toast.error(result.error);
        router.refresh();
        return;
      }
    }
    setSaving(false);
    toast.success('Put back');
    router.refresh();
  };

  /**
   * Put `orderedIds` on `date` in that order. `movedIds` are the ones that came from another day (they get the
   * toast and the Undo); a plain reorder passes none and says nothing.
   */
  const place = async (date: Ymd | null, orderedIds: string[], movedIds: string[]): Promise<boolean> => {
    if (busy.current || orderedIds.length === 0) return false;
    const before = current.current;
    const cameFrom = new Map<Ymd | null, string[]>();
    for (const id of movedIds) {
      const job = before.find((j) => j.id === id);
      if (!job || job.date === date || cameFrom.has(job.date)) continue;
      cameFrom.set(job.date, flattenDay(before.filter((j) => j.date === job.date)).map((j) => j.id));
    }
    const at = new Map(orderedIds.map((id, index) => [id, index + 1]));
    setJobs(before.map((job) => (at.has(job.id) ? { ...job, date, position: at.get(job.id)! } : job)));
    setSaving(true);
    const result = await placeProJobs(date, orderedIds);
    setSaving(false);
    if (!result.success) {
      setJobs(before);
      toast.error(result.error);
      return false;
    }
    if (cameFrom.size > 0) {
      const moved = movedIds.filter((id) => before.find((j) => j.id === id)?.date !== date).length;
      toast.success(date ? `Moved ${jobsWord(moved)} to ${formatBoardDay(date)}` : `Took the date off ${jobsWord(moved)}`, {
        action: { label: 'Undo', onClick: () => void undoMove(before, cameFrom) },
      });
    }
    router.refresh();
    return true;
  };

  /** Give these jobs to someone. They reach the worker's phone when you send them from Jobs. */
  const give = async (ids: string[], worker: CalendarWorker): Promise<boolean> => {
    if (busy.current || ids.length === 0) return false;
    const before = current.current;
    const chosen = new Set(ids);
    setJobs(
      before.map((job) =>
        chosen.has(job.id)
          ? { ...job, workerId: worker.id, worker: worker.name, status: statusAfterWorkerAssignment(job.status ?? 'pending') }
          : job,
      ),
    );
    setSaving(true);
    const result = await bulkAssignJobs(ids, worker.id);
    setSaving(false);
    if (!result.success) {
      setJobs(before);
      toast.error(result.error);
      return false;
    }
    toast.success(`Gave ${jobsWord(ids.length)} to ${firstName(worker.name)}`, {
      description: 'Not sent yet. Send from Jobs when you are ready.',
      action: { label: 'Send', onClick: () => router.push('/jobs?status=pending_send') },
    });
    router.refresh();
    return true;
  };

  return { jobs, saving, place, give, merge };
}
