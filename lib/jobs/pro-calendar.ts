/**
 * Layout for the Pro calendar: which days a view covers, where each job stands, who has it, and how a day's jobs
 * sit in groups and lanes. Pure — safe on the server and in the browser.
 */

import type { Tone } from '@/components/look/tones';
import { canAssignWorkerInline } from '@/lib/jobs/worker-assignment-status';
import { ROUND_COLOURS } from '@/lib/rounds/rounds';
import { personColours } from '@/lib/rounds/lanes';
import { initialRange, rangeEnd } from '@/lib/rounds/week-board';
import {
  addDays,
  endOfMonth,
  isoWeekday,
  isValidYmd,
  startOfMonth,
  type Ymd,
} from '@/lib/rounds/dates';

export type ProCalendarView = 'day' | 'week' | 'month';

export type ProCalendarJob = {
  id: string;
  reference: string | null;
  /** Address, or the reference when there is no address. */
  title: string;
  postcode: string | null;
  customer: string | null;
  worker: string | null;
  workerId: string | null;
  status: string | null;
  priority: string | null;
  /** `HH:MM`, or null when the job has no time. */
  time: string | null;
  date: Ymd | null;
  /** What the job is, when we have it. */
  detail: string | null;
  groupId: string | null;
  groupLabel: string | null;
  /** Order on the day. Null until the job has been dragged into a place. */
  position: number | null;
};

export type CalendarWorker = { id: string; name: string };

export type JobGroupTag = { id: string; name: string; colour: string };

export type DaySegment =
  | { kind: 'jobs'; jobs: ProCalendarJob[] }
  | { kind: 'group'; group: JobGroupTag; jobs: ProCalendarJob[] };

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Fewest jobs before they are drawn as a group. One job alone is just a card. */
const MIN_GROUP_SIZE = 2;

export function parseCalendarView(raw: string | undefined): ProCalendarView {
  if (raw === 'day' || raw === 'week' || raw === 'month') return raw;
  return 'week';
}

function parts(ymd: Ymd): { year: number; month: number; day: number } {
  const [year, month, day] = ymd.split('-').map(Number);
  return { year: year || 0, month: month || 1, day: day || 1 };
}

function padYmd(year: number, month: number, day: number): Ymd {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Monday–Sunday week that contains `date`. */
export function weekBounds(date: Ymd): { from: Ymd; to: Ymd } {
  const from = addDays(date, 1 - isoWeekday(date));
  return { from, to: addDays(from, 6) };
}

export function daysOfWeek(date: Ymd): Ymd[] {
  const { from } = weekBounds(date);
  return Array.from({ length: 7 }, (_, i) => addDays(from, i));
}

/** First of the month `delta` months away from the month of `date`. */
export function addMonthsYmd(date: Ymd, delta: number): Ymd {
  const { year, month } = parts(startOfMonth(date));
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return padYmd(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1);
}

export type MonthCell = { ymd: Ymd; inMonth: boolean };

/** Monday-first grid covering the month, including the leading and trailing days. */
export function monthCells(date: Ymd): MonthCell[] {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  const from = addDays(start, 1 - isoWeekday(start));
  const tail = 7 - isoWeekday(end);
  const to = tail === 7 ? end : addDays(end, tail);
  const cells: MonthCell[] = [];
  let cursor = from;
  while (cursor <= to) {
    cells.push({ ymd: cursor, inMonth: cursor >= start && cursor <= end });
    cursor = addDays(cursor, 1);
  }
  return cells;
}

/**
 * The dates to load for a view. The week board opens like the Rounds one: two weeks back, this week and three
 * ahead, and loads more as you scroll. Undated jobs are loaded as well, separately.
 */
export function fetchWindow(view: ProCalendarView, date: Ymd): { from: Ymd; to: Ymd } {
  if (view === 'day') return { from: date, to: date };
  if (view === 'month') {
    const cells = monthCells(date);
    return { from: cells[0]!.ymd, to: cells[cells.length - 1]!.ymd };
  }
  const range = initialRange(date);
  return { from: range.from, to: rangeEnd(range) };
}

export function shiftAnchor(view: ProCalendarView, date: Ymd, delta: -1 | 1): Ymd {
  if (view === 'month') return addMonthsYmd(date, delta);
  if (view === 'week') return addDays(date, delta * 7);
  return addDays(date, delta);
}

export function showingToday(view: ProCalendarView, date: Ymd, today: Ymd): boolean {
  if (view === 'month') return startOfMonth(date) === startOfMonth(today);
  if (view === 'day') return date === today;
  const week = weekBounds(date);
  return today >= week.from && today <= week.to;
}

export function dayHeading(ymd: Ymd): string {
  const { year, month, day } = parts(ymd);
  const weekday = WEEKDAYS[isoWeekday(ymd) - 1] ?? 'Monday';
  return `${weekday} ${day} ${MONTHS[month - 1] ?? ''} ${year}`;
}

export function rangeLabel(view: ProCalendarView, date: Ymd): string {
  if (view === 'day') return dayHeading(date);
  if (view === 'month') {
    const { year, month } = parts(startOfMonth(date));
    return `${MONTHS[month - 1] ?? ''} ${year}`;
  }
  const { from, to } = weekBounds(date);
  const a = parts(from);
  const b = parts(to);
  return a.month === b.month
    ? `${a.day}–${b.day} ${MONTHS_SHORT[a.month - 1]} ${a.year}`
    : `${a.day} ${MONTHS_SHORT[a.month - 1]} – ${b.day} ${MONTHS_SHORT[b.month - 1]} ${b.year}`;
}

/* ---------- Where a job stands ---------- */

export type JobState =
  | 'no_one'
  | 'declined'
  | 'not_sent'
  | 'sent'
  | 'accepted'
  | 'in_progress'
  | 'paused'
  | 'not_finished'
  | 'done';

/** One word for each state, and the colour of the bar down the card's left edge. */
export const JOB_STATE: Record<JobState, { label: string; tone: Tone }> = {
  no_one: { label: 'No one yet', tone: 'amber' },
  declined: { label: 'Declined', tone: 'rose' },
  not_sent: { label: 'Not sent', tone: 'amber' },
  sent: { label: 'Sent', tone: 'indigo' },
  accepted: { label: 'Accepted', tone: 'indigo' },
  in_progress: { label: 'In progress', tone: 'sky' },
  paused: { label: 'Paused', tone: 'amber' },
  not_finished: { label: 'Not finished', tone: 'rose' },
  done: { label: 'Done', tone: 'emerald' },
};

export function jobState(job: Pick<ProCalendarJob, 'status' | 'workerId'>): JobState {
  switch (job.status) {
    case 'completed':
      return 'done';
    case 'in_progress':
    case 'en_route':
    case 'arrived':
      return 'in_progress';
    case 'paused':
      return 'paused';
    case 'incomplete':
      return 'not_finished';
    case 'declined':
      return 'declined';
    default:
      break;
  }
  if (!job.workerId) return 'no_one';
  if (job.status === 'accepted') return 'accepted';
  if (job.status === 'assigned') return 'sent';
  return 'not_sent';
}

/** Someone in the office has to do something about it. */
export function needsYou(job: Pick<ProCalendarJob, 'status' | 'workerId'>): boolean {
  const state = jobState(job);
  return state === 'no_one' || state === 'declined' || state === 'not_sent';
}

/** It can go on another day. Once someone is on it, or it is finished, its day stays put. */
export function canMove(job: Pick<ProCalendarJob, 'status'>): boolean {
  return !['completed', 'cancelled', 'in_progress', 'en_route', 'arrived'].includes(job.status ?? 'pending');
}

/** It can be given to someone from the calendar. Same rule as the jobs list's picker. */
export function canGive(job: Pick<ProCalendarJob, 'status'>): boolean {
  return canAssignWorkerInline(job.status);
}

/** Who is doing it. A declined job is back with no one: the person who said no isn't doing it. */
export function holderOf(job: Pick<ProCalendarJob, 'status' | 'workerId'>): string | null {
  return job.status === 'declined' ? null : job.workerId;
}

/** "48 Gainsford Road" from "48 Gainsford Road, London E17 6QB". */
export function streetOf(address: string, postcode: string | null): string {
  let text = address.trim();
  if (postcode) {
    const squashed = postcode.replace(/\s+/g, '').toUpperCase();
    const chars = squashed.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`[,\\s]*${chars.join('\\s*')}\\s*$`, 'i');
    text = text.replace(pattern, '');
  }
  const first = text.split(',')[0]?.trim();
  return first || address.trim();
}

export function firstName(name: string | null | undefined): string {
  const words = name?.trim().split(/\s+/) ?? [];
  return words[0] || 'Someone';
}

/* ---------- People ---------- */

/** A steady colour per person, the same palette the Rounds lanes use. */
export function workerColours(workers: ReadonlyArray<CalendarWorker>): Map<string, Tone> {
  return personColours(workers.map((w) => ({ workerId: w.id, name: w.name, isOwner: false })));
}

/** The ?person= value: 'all', 'none' (no one has it yet), or a worker. Anything else is 'all'. */
export type PersonFilter = 'all' | 'none' | string;

export function parsePersonFilter(raw: string | undefined, workers: ReadonlyArray<CalendarWorker>): PersonFilter {
  if (raw === 'none') return 'none';
  if (raw && workers.some((w) => w.id === raw)) return raw;
  return 'all';
}

export function filterJobs(jobs: readonly ProCalendarJob[], person: PersonFilter): ProCalendarJob[] {
  if (person === 'all') return [...jobs];
  if (person === 'none') return jobs.filter((job) => holderOf(job) === null);
  return jobs.filter((job) => holderOf(job) === person);
}

export type DayPerson = { workerId: string | null; name: string; count: number };

/** Who has work in this list, most first, and how many have no one. For the chips on a day's header. */
export function peopleOn(jobs: readonly ProCalendarJob[]): { people: DayPerson[]; noOne: number } {
  const map = new Map<string, DayPerson>();
  let noOne = 0;
  for (const job of jobs) {
    const id = holderOf(job);
    if (!id) {
      if (jobState(job) !== 'done') noOne += 1;
      continue;
    }
    const entry = map.get(id) ?? { workerId: id, name: job.worker ?? 'Someone', count: 0 };
    entry.count += 1;
    map.set(id, entry);
  }
  const people = [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { people, noOne };
}

export type DayLane = {
  /** The worker's id, or 'none'. */
  key: string;
  workerId: string | null;
  name: string;
  colour: Tone;
  jobs: ProCalendarJob[];
};

/**
 * The Day view: one lane per person who has work, then everyone else when `everyone` is on. Jobs no one has
 * (including declined ones) come first, in their own lane, when there are any.
 */
export function dayLanes(
  jobs: readonly ProCalendarJob[],
  workers: ReadonlyArray<CalendarWorker>,
  everyone: boolean,
): DayLane[] {
  const colours = workerColours(workers);
  const named = new Map(workers.map((w) => [w.id, w.name] as const));
  const lanes = new Map<string, DayLane>();
  const none: ProCalendarJob[] = [];
  for (const job of jobs) {
    const id = holderOf(job);
    if (!id) {
      none.push(job);
      continue;
    }
    const lane = lanes.get(id) ?? {
      key: id,
      workerId: id,
      name: named.get(id) ?? job.worker ?? 'Someone',
      colour: colours.get(id) ?? 'slate',
      jobs: [],
    };
    lane.jobs.push(job);
    lanes.set(id, lane);
  }
  if (everyone) {
    for (const worker of workers) {
      if (!lanes.has(worker.id)) {
        lanes.set(worker.id, { key: worker.id, workerId: worker.id, name: worker.name, colour: colours.get(worker.id) ?? 'slate', jobs: [] });
      }
    }
  }
  const people = [...lanes.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return none.length > 0 ? [{ key: 'none', workerId: null, name: 'No one yet', colour: 'amber', jobs: none }, ...people] : people;
}

/* ---------- Counts ---------- */

export type JobCounts = { total: number; done: number; noOne: number; notSent: number; declined: number };

export function countJobs(jobs: readonly ProCalendarJob[]): JobCounts {
  const counts: JobCounts = { total: 0, done: 0, noOne: 0, notSent: 0, declined: 0 };
  for (const job of jobs) {
    counts.total += 1;
    const state = jobState(job);
    if (state === 'done') counts.done += 1;
    else if (state === 'no_one') counts.noOne += 1;
    else if (state === 'not_sent') counts.notSent += 1;
    else if (state === 'declined') counts.declined += 1;
  }
  return counts;
}

/** "6 jobs · 2 done" for a column or lane header. */
export function countLine(jobs: readonly ProCalendarJob[]): string {
  if (jobs.length === 0) return 'No jobs';
  const { total, done } = countJobs(jobs);
  return `${total} ${total === 1 ? 'job' : 'jobs'}${done > 0 ? ` · ${done} done` : ''}`;
}

/* ---------- Big teams ---------- */

/** Above this many people the Day view opens as a list of people rather than a lane each. */
export const LANES_UP_TO = 8;

/** How many jobs each person has in this list. A declined job is back with no one, so it doesn't count. */
export function jobsByPerson(jobs: readonly ProCalendarJob[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const id = holderOf(job);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Every word typed is the start of a word in the name: "da sm" finds Dave Smith. */
export function nameMatches(name: string, query: string): boolean {
  const typed = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (typed.length === 0) return true;
  const words = name.toLowerCase().split(/[\s'-]+/).filter(Boolean);
  return typed.every((part) => words.some((word) => word.startsWith(part)));
}

export type PeopleShow = 'working' | 'free' | 'everyone';
export type PeopleSort = 'name' | 'fewest';

/**
 * The people rows on the Day list: searched by name, then those with work that day, those with none, or everyone.
 * "Fewest jobs" puts whoever has room at the top, for handing out work.
 */
export function pickPeople(
  lanes: readonly DayLane[],
  options: { query: string; show: PeopleShow; sort: PeopleSort },
): DayLane[] {
  const people = lanes.filter((lane) => lane.workerId !== null && nameMatches(lane.name, options.query));
  const shown = people.filter((lane) =>
    options.show === 'working' ? lane.jobs.length > 0 : options.show === 'free' ? lane.jobs.length === 0 : true,
  );
  const byName = (a: DayLane, b: DayLane) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  return options.sort === 'fewest' ? shown.sort((a, b) => a.jobs.length - b.jobs.length || byName(a, b)) : shown.sort(byName);
}

export type GiveChoice = { worker: CalendarWorker; count: number };

/**
 * Who to offer when giving work out: people already working that day with the fewest jobs first, then everyone
 * who is free, A–Z. `load` is each person's jobs that day.
 */
export function giveChoices(
  workers: ReadonlyArray<CalendarWorker>,
  load: ReadonlyMap<string, number>,
  query: string,
): { working: GiveChoice[]; free: GiveChoice[] } {
  const working: GiveChoice[] = [];
  const free: GiveChoice[] = [];
  for (const worker of workers) {
    if (!nameMatches(worker.name, query)) continue;
    const count = load.get(worker.id) ?? 0;
    (count > 0 ? working : free).push({ worker, count });
  }
  working.sort((a, b) => a.count - b.count || a.worker.name.localeCompare(b.worker.name));
  free.sort((a, b) => a.worker.name.localeCompare(b.worker.name));
  return { working, free };
}

/**
 * Fold freshly loaded jobs into the ones on screen: `fresh` replaces every job dated between `from` and `to` (and,
 * with `undated`, the jobs with no date), and the weeks loaded earlier by scrolling stay as they are.
 */
export function mergeJobs(
  prev: readonly ProCalendarJob[],
  fresh: readonly ProCalendarJob[],
  range: { from: Ymd; to: Ymd; undated: boolean },
): ProCalendarJob[] {
  const ids = new Set(fresh.map((job) => job.id));
  const kept = prev.filter((job) => {
    if (ids.has(job.id)) return false;
    if (job.date === null) return !range.undated;
    return job.date < range.from || job.date > range.to;
  });
  return [...kept, ...fresh];
}

/** A group with more jobs than this starts folded to its header, so a busy day stays readable. */
export const FOLD_GROUPS_OVER = 5;

/* ---------- Groups and order ---------- */

/** Same palette as a round, picked from the group's id so it never changes. */
export function groupColour(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  }
  return ROUND_COLOURS[hash % ROUND_COLOURS.length]!;
}

export function groupTag(job: ProCalendarJob): JobGroupTag | null {
  if (!job.groupId) return null;
  return {
    id: job.groupId,
    name: job.groupLabel?.trim() || 'Group',
    colour: groupColour(job.groupId),
  };
}

function byPlace(a: ProCalendarJob, b: ProCalendarJob): number {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.position ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  const ta = a.time ?? '99:99';
  const tb = b.time ?? '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/**
 * One day's jobs, in the order they were put there (then by time). A run of two
 * or more from the same group is drawn as one box. A group of one, or a group
 * split by another job, stays as ordinary cards. The order is never rearranged
 * to pull a group together.
 */
export function layOutDay(jobs: readonly ProCalendarJob[]): DaySegment[] {
  const sorted = [...jobs].sort(byPlace);
  const segments: DaySegment[] = [];
  let i = 0;
  while (i < sorted.length) {
    const job = sorted[i]!;
    let j = i + 1;
    if (job.groupId) {
      while (j < sorted.length && sorted[j]!.groupId === job.groupId) j += 1;
    }
    const run = sorted.slice(i, job.groupId ? j : i + 1);
    const tag = groupTag(job);
    if (tag && run.length >= MIN_GROUP_SIZE) {
      segments.push({ kind: 'group', group: tag, jobs: run });
      i = j;
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && last.kind === 'jobs') last.jobs.push(...run);
    else segments.push({ kind: 'jobs', jobs: [...run] });
    i = job.groupId ? j : i + 1;
  }
  return segments;
}

/** The jobs of a day in the order they are drawn. */
export function flattenDay(jobs: readonly ProCalendarJob[]): ProCalendarJob[] {
  return layOutDay(jobs).flatMap((segment) => segment.jobs);
}

/**
 * The day's ids after a drop. `index` is the place among the jobs that are
 * staying (the ones being moved are taken out first).
 */
export function orderAfterDrop(columnIds: readonly string[], movingIds: readonly string[], index: number): string[] {
  const moving = new Set(movingIds);
  const staying = columnIds.filter((id) => !moving.has(id));
  const block = [...new Set(movingIds)];
  const at = Math.max(0, Math.min(index, staying.length));
  return [...staying.slice(0, at), ...block, ...staying.slice(at)];
}

/**
 * The same, when only some of the day is on screen (the Person filter is on). `index` counts the jobs you can see;
 * the hidden ones keep their places around them.
 */
export function orderAfterFilteredDrop(
  allIds: readonly string[],
  visibleIds: readonly string[],
  movingIds: readonly string[],
  index: number,
): string[] {
  const moving = new Set(movingIds);
  const visible = visibleIds.filter((id) => !moving.has(id));
  if (visible.length === allIds.filter((id) => !moving.has(id)).length) return orderAfterDrop(allIds, movingIds, index);
  const staying = allIds.filter((id) => !moving.has(id));
  const block = [...new Set(movingIds)];
  const at = Math.max(0, Math.min(index, visible.length));
  let cut: number;
  if (visible.length === 0) cut = staying.length;
  else if (at < visible.length) cut = staying.indexOf(visible[at]!);
  else cut = staying.indexOf(visible[visible.length - 1]!) + 1;
  if (cut < 0) cut = staying.length;
  return [...staying.slice(0, cut), ...block, ...staying.slice(cut)];
}

/**
 * The whole day's order after a drop into one lane of the Day view: every lane keeps its own order, the moved
 * jobs go into `target` at `index`, and the lanes are read top to bottom, left to right.
 */
export function dayOrderAfterLaneDrop(
  lanes: ReadonlyArray<{ key: string; ids: readonly string[] }>,
  target: string,
  movingIds: readonly string[],
  index: number,
): string[] {
  const moving = new Set(movingIds);
  const out: string[] = [];
  let placed = false;
  for (const lane of lanes) {
    if (lane.key === target) {
      out.push(...orderAfterDrop(lane.ids, movingIds, index));
      placed = true;
    } else {
      out.push(...lane.ids.filter((id) => !moving.has(id)));
    }
  }
  if (!placed) out.push(...movingIds.filter((id) => !out.includes(id)));
  return [...new Set(out)];
}

export type DayChip = { id: string; name: string; colour: string; count: number };

/** Coloured chips for the month cell: one per group, plus how many jobs sit outside a group. */
export function dayChips(jobs: readonly ProCalendarJob[]): { groups: DayChip[]; loose: number; total: number } {
  const counts = new Map<string, DayChip>();
  let loose = 0;
  for (const job of jobs) {
    const tag = groupTag(job);
    if (!tag) {
      loose += 1;
      continue;
    }
    const existing = counts.get(tag.id);
    if (existing) existing.count += 1;
    else counts.set(tag.id, { id: tag.id, name: tag.name, colour: tag.colour, count: 1 });
  }
  const groups = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { groups, loose, total: jobs.length };
}

export function isValidCalendarDate(value: string | undefined): value is Ymd {
  return isValidYmd(value);
}
