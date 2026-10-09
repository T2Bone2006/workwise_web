'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { rowHover } from '@/components/look/row-hover';
import { loadWorkerCalendarWeeks } from '@/lib/actions/worker/calendar';
import { addDays } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';
import { weekStart } from '@/lib/worker/dashboard';
import type { WorkerJob } from '@/lib/worker/types';
import {
  WEEK_BOARD_STEP_WEEKS,
  buildWorkerWeeks,
  extendWeekRange,
  formatWorkerBoardDay,
  rangeEnd,
  shownBoardDays,
  type WorkerBoardCard,
  type WorkerBoardDay,
  type WorkerBoardRange,
  type WorkerBoardState,
} from '@/lib/worker/week-board';

const EDGE_PX = 400;
const CHUNK_WEEKS = WEEK_BOARD_STEP_WEEKS * 2;

const BAR: Record<WorkerBoardState, string> = {
  planned: 'bg-(--tone-sky-solid)',
  underway: 'bg-(--tone-sky-solid)',
  incomplete: 'bg-(--tone-amber-solid)',
  done: 'bg-(--tone-emerald-solid)',
};

/** Replace the jobs that fall on or between `from` and `to` with the freshly loaded ones. */
function mergeJobs(prev: WorkerJob[], fetched: WorkerJob[], from: string, to: string): WorkerJob[] {
  const kept = prev.filter((job) => !job.scheduledDate || job.scheduledDate < from || job.scheduledDate > to);
  return [...kept, ...fetched];
}

async function fetchWeeks(
  from: string,
  weeks: number,
): Promise<{ ok: true; jobs: WorkerJob[] } | { ok: false; error: string }> {
  const parts: Promise<Awaited<ReturnType<typeof loadWorkerCalendarWeeks>>>[] = [];
  for (let done = 0; done < weeks; done += CHUNK_WEEKS) {
    parts.push(loadWorkerCalendarWeeks({ from: addDays(from, done * 7), weeks: Math.min(CHUNK_WEEKS, weeks - done) }));
  }
  const results = await Promise.all(parts);
  const jobs: WorkerJob[] = [];
  for (const result of results) {
    if (!result.ok) return { ok: false, error: result.error };
    jobs.push(...result.jobs);
  }
  return { ok: true, jobs };
}

/** Soft edge on the week scroller: days blur, then fade, instead of ending on a hard cut. */
function BoardEdgeFade({ side, on }: { side: 'left' | 'right'; on: boolean }): JSX.Element {
  const left = side === 'left';
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-y-0 z-10 w-8 transition-opacity duration-200 ${
        left ? 'left-0' : 'right-0'
      } ${on ? 'opacity-100' : 'opacity-0'}`}
    >
      <div
        className={`absolute inset-0 backdrop-blur-sm ${
          left
            ? '[mask-image:linear-gradient(to_right,black,transparent)] [-webkit-mask-image:linear-gradient(to_right,black,transparent)]'
            : '[mask-image:linear-gradient(to_left,black,transparent)] [-webkit-mask-image:linear-gradient(to_left,black,transparent)]'
        }`}
      />
      <div
        className={`absolute inset-y-0 w-5 from-background to-transparent ${
          left ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l'
        }`}
      />
    </div>
  );
}

function JobCard({ job }: { job: WorkerBoardCard }): JSX.Element {
  const where = [job.street, job.postcode].filter(Boolean).join(' · ');
  const dimmed = job.state === 'done' || job.state === 'incomplete';
  const label = [job.name, job.time, job.title, job.tag].filter(Boolean).join(', ');
  return (
    <Link
      href={`/worker/jobs/${job.id}`}
      aria-label={label}
      className={cn(
        'relative block w-full overflow-hidden rounded-xl border border-border bg-card py-2 pl-3.5 pr-2.5 text-left',
        'focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none',
        rowHover,
        dimmed && 'opacity-60',
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', BAR[job.state])} aria-hidden />
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{job.name}</span>
        {job.time ? <span className="shrink-0 text-xs text-muted-foreground">{job.time}</span> : null}
      </span>
      {where ? <span className="block truncate text-xs text-muted-foreground">{where}</span> : null}
      {job.title !== job.name ? (
        <span className="block truncate text-xs text-muted-foreground">{job.title}</span>
      ) : null}
      {job.urgent || job.tag ? (
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {job.urgent ? (
            <span className="rounded-full bg-(--tone-rose-soft) px-1.5 text-[11px] font-medium leading-4 text-(--tone-rose-text)">
              Urgent
            </span>
          ) : null}
          {job.tag ? <span className="font-medium text-muted-foreground">{job.tag}</span> : null}
        </span>
      ) : null}
    </Link>
  );
}

function DayColumn({ day }: { day: WorkerBoardDay }): JSX.Element {
  const summary = [`${day.total} ${day.total === 1 ? 'job' : 'jobs'}`, day.total > 0 ? `${day.done}/${day.total} done` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      data-date={day.date}
      aria-label={formatWorkerBoardDay(day.date)}
      className={cn(
        'flex h-[calc(100vh-14rem)] min-h-80 shrink-0 flex-col rounded-2xl border border-border bg-card shadow-(--look-card-shadow)',
        'w-[200px] @min-[960px]/board:w-auto @min-[960px]/board:min-w-0 @min-[960px]/board:flex-1 @min-[960px]/board:shrink',
        day.isToday && 'ring-2 ring-(--tone-sky-solid)',
      )}
    >
      <header className="border-b border-border px-2.5 py-2">
        <p className={cn('flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground', day.isPast && 'text-muted-foreground')}>
          {formatWorkerBoardDay(day.date)}
          {day.isToday ? (
            <span className="rounded-full bg-(--tone-sky-solid) px-1.5 text-[10px] font-bold leading-4 text-white">Today</span>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{summary}</p>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {day.jobs.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-border bg-card/60 text-xs text-muted-foreground">
            No jobs
          </div>
        ) : (
          day.jobs.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </div>
    </section>
  );
}

/** Days side by side, a gap between weeks, scrolling left and right — the Rounds week board, for this worker's jobs. */
export function WorkerWeekBoard(props: {
  initialJobs: WorkerJob[];
  initialRange: WorkerBoardRange;
  today: string;
  /** The week that should sit at the left when the board opens. */
  focusDate: string;
}): JSX.Element {
  const { today, focusDate } = props;
  const [jobs, setJobs] = useState(props.initialJobs);
  const [range, setRange] = useState(props.initialRange);
  const [loadingEdge, setLoadingEdge] = useState<'earlier' | 'later' | null>(null);
  const [clipped, setClipped] = useState({ left: false, right: false });

  const scroller = useRef<HTMLDivElement>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const loadingRef = useRef(false);
  const keep = useRef<{ left: number; width: number } | null>(null);
  const rangeStartMoved = useRef(false);
  const didInitialScroll = useRef(false);

  const weeks = useMemo(
    () => buildWorkerWeeks({ jobs, from: range.from, weeks: range.weeks, today }),
    [jobs, range, today],
  );

  const syncEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 24;
    const right = el.scrollWidth - el.clientWidth - el.scrollLeft > 24;
    setClipped((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useLayoutEffect(() => {
    if (!didInitialScroll.current) {
      const el = scroller.current;
      const week = el?.querySelector<HTMLElement>(`[data-week-start="${weekStart(focusDate)}"]`);
      if (el && week) {
        el.scrollLeft = week.offsetLeft;
        didInitialScroll.current = true;
      }
    }
    syncEdges();
  }, [focusDate, weeks, syncEdges]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !keep.current) return;
    el.scrollLeft = keep.current.left + (el.scrollWidth - keep.current.width) * (rangeStartMoved.current ? 1 : 0);
    keep.current = null;
    rangeStartMoved.current = false;
    syncEdges();
  }, [range, syncEdges]);

  const loadMore = useCallback(async (dir: 'earlier' | 'later') => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingEdge(dir);
    try {
      const current = rangeRef.current;
      const next = extendWeekRange(current, dir);
      const fromDate = dir === 'earlier' ? next.from : addDays(rangeEnd(current), 1);
      const loaded = await fetchWeeks(fromDate, WEEK_BOARD_STEP_WEEKS);
      if (!loaded.ok) {
        toast.error(loaded.error);
        return;
      }
      const el = scroller.current;
      if (el) keep.current = { left: el.scrollLeft, width: el.scrollWidth };
      rangeStartMoved.current = next.from !== current.from;
      setJobs((prev) =>
        mergeJobs(prev, loaded.jobs, fromDate, rangeEnd({ from: fromDate, weeks: WEEK_BOARD_STEP_WEEKS })),
      );
      setRange(next);
    } finally {
      loadingRef.current = false;
      setLoadingEdge(null);
    }
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    syncEdges();
    const observer = new ResizeObserver(() => syncEdges());
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncEdges, weeks]);

  const onScroll = () => {
    syncEdges();
    const el = scroller.current;
    if (!el || loadingRef.current) return;
    if (el.scrollLeft < EDGE_PX) void loadMore('earlier');
    else if (el.scrollWidth - (el.scrollLeft + el.clientWidth) < EDGE_PX) void loadMore('later');
  };

  return (
    <div className="@container/board relative min-w-0">
      <div ref={scroller} onScroll={onScroll} className="relative flex gap-4 overflow-x-auto overscroll-x-contain pb-3">
        {weeks.map((week) => {
          const days = shownBoardDays(week.days);
          const total = days.reduce((sum, day) => sum + day.total, 0);
          return (
            <div key={week.weekStart} data-week-start={week.weekStart} className="w-max shrink-0 @min-[960px]/board:w-full @min-[960px]/board:min-w-0">
              <p className="mb-2 px-1 text-xs text-muted-foreground">
                {week.label} · {total} {total === 1 ? 'job' : 'jobs'}
              </p>
              <div className="flex gap-2 @min-[960px]/board:w-full @min-[960px]/board:min-w-0">
                {days.map((day) => (
                  <DayColumn key={day.date} day={day} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {loadingEdge ? (
        <div
          className={
            loadingEdge === 'earlier'
              ? 'pointer-events-none absolute left-2 top-1/2 z-20'
              : 'pointer-events-none absolute right-2 top-1/2 z-20'
          }
        >
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading more weeks" />
        </div>
      ) : null}
      <BoardEdgeFade side="left" on={clipped.left} />
      <BoardEdgeFade side="right" on={clipped.right} />
    </div>
  );
}
