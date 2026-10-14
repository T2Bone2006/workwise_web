'use client';

import { Fragment, useState } from 'react';
import type { Tone } from '@/components/look/tones';
import { FOLD_GROUPS_OVER, layOutDay, type CalendarWorker, type ProCalendarJob } from '@/lib/jobs/pro-calendar';
import type { Ymd } from '@/lib/rounds/dates';
import type { AskGive } from './give-picker';
import { DropGap, ProGroupBox, ProJobCard, type MoveOption } from './pro-job-card';

export type JobListProps = {
  /** The column or lane key, carried by anything picked up here. */
  from: string;
  /** The day these jobs are on (null: no date yet). */
  date: Ymd | null;
  jobs: ProCalendarJob[];
  lifted: ReadonlySet<string>;
  gapIndex: number | null;
  gapHeight: number;
  showWorker?: boolean;
  colours: ReadonlyMap<string, Tone>;
  workers: ReadonlyArray<CalendarWorker>;
  moveOptions: ReadonlyArray<MoveOption>;
  canDrag: (job: ProCalendarJob) => boolean;
  /** Which jobs of a group go with it when its handle is dragged. */
  groupLift: (jobs: ProCalendarJob[]) => string[];
  emptyText: string;
  onMove: (job: ProCalendarJob, date: Ymd | null) => void;
  onAskGive: AskGive;
};

/**
 * A column's (or lane's) jobs top to bottom: loose cards, and runs from one group in their coloured box. The dashed
 * gap sits where a held job would land; places are counted without the jobs that are in the air. A big group starts
 * folded; opening or folding one is remembered while the page is open.
 */
export function JobList(props: JobListProps) {
  const [foldOverride, setFoldOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
  const segments = layOutDay(props.jobs);
  const placeOf = new Map<string, number>();
  for (const job of segments.flatMap((segment) => segment.jobs)) {
    if (!props.lifted.has(job.id)) placeOf.set(job.id, placeOf.size);
  }
  const gapAt = (place: number | undefined) =>
    place !== undefined && props.gapIndex === place ? <DropGap key={`gap-${place}`} height={props.gapHeight} /> : null;
  const visibleCount = placeOf.size;
  const canGiveOut = props.workers.length > 0;

  const card = (job: ProCalendarJob) => {
    const isLifted = props.lifted.has(job.id);
    const before = isLifted ? null : gapAt(placeOf.get(job.id));
    return (
      <Fragment key={job.id}>
        {before}
        <ProJobCard
          job={job}
          from={props.from}
          draggable={props.canDrag(job)}
          lifted={isLifted}
          showWorker={props.showWorker}
          colours={props.colours}
          canGiveOut={canGiveOut}
          moveOptions={props.moveOptions}
          onMove={props.onMove}
          onAskGive={props.onAskGive}
        />
      </Fragment>
    );
  };

  return (
    <>
      {visibleCount === 0 && props.gapIndex === null ? (
        <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-3 text-center text-xs text-muted-foreground">
          {props.emptyText}
        </div>
      ) : null}
      {segments.map((segment, index) => {
        if (segment.kind === 'jobs') return <Fragment key={`loose-${index}`}>{segment.jobs.map(card)}</Fragment>;
        const foldKey = `${segment.group.id}:${segment.jobs[0]?.id ?? index}`;
        const folded = foldOverride.get(foldKey) ?? segment.jobs.length > FOLD_GROUPS_OVER;
        const lift = props.groupLift(segment.jobs);
        const wholeLifted = segment.jobs.every((job) => props.lifted.has(job.id));
        const firstPlace = segment.jobs.map((job) => placeOf.get(job.id)).find((place) => place !== undefined);
        return (
          <Fragment key={`group-${foldKey}`}>
            {folded ? gapAt(firstPlace) : null}
            <ProGroupBox
              group={segment.group}
              jobs={segment.jobs}
              liftIds={lift}
              from={props.from}
              date={props.date}
              lifted={wholeLifted}
              folded={folded}
              onFold={(next) => setFoldOverride((prev) => new Map(prev).set(foldKey, next))}
              showWorker={props.showWorker}
              colours={props.colours}
              workers={props.workers}
              canGiveOut={canGiveOut}
              onAskGive={props.onAskGive}
            >
              {segment.jobs.map(card)}
            </ProGroupBox>
          </Fragment>
        );
      })}
      {gapAt(visibleCount)}
    </>
  );
}
