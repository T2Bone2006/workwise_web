import { describe, expect, it } from 'vitest';
import { dayCounts, planDay, urgentDays } from '@/lib/worker/day-plan';
import { blockedReason, historyLines, hhmm, mapJobRow, titleFromDescription } from '@/lib/worker/map-job';
import { isUrgent, workerTag } from '@/lib/worker/status';
import { parseJobsTab, type WorkerJob } from '@/lib/worker/types';

const job = (over: Partial<WorkerJob> = {}): WorkerJob => ({
  id: 'a',
  referenceNumber: 'J-1',
  title: 'Change lock',
  status: 'accepted',
  priority: 'normal',
  scheduledDate: '2026-10-08',
  scheduledTime: '09:00',
  address: '1 High St',
  postcode: 'AB1 2CD',
  customerName: 'Pat',
  completedAt: null,
  notBecause: null,
  ...over,
});

describe('workerTag / isUrgent', () => {
  it('uses one colour per meaning, like the phone', () => {
    expect(workerTag({ status: 'completed' })).toEqual({ label: 'Done', tone: 'green' });
    expect(workerTag({ status: 'declined' })).toEqual({ label: 'Declined', tone: 'rose' });
    expect(workerTag({ status: 'incomplete' })).toEqual({ label: 'Not completed', tone: 'amber' });
    expect(workerTag({ status: 'in_progress' })?.tone).toBe('blue');
    expect(workerTag({ status: 'arrived' })?.label).toBe('In progress');
    expect(workerTag({ status: 'assigned' })?.label).toBe('Waiting for you');
    expect(workerTag({ status: 'pending' })).toBeNull();
  });

  it('calls high and emergency urgent, nothing else', () => {
    expect(isUrgent({ priority: 'high' })).toBe(true);
    expect(isUrgent({ priority: 'emergency' })).toBe(true);
    expect(isUrgent({ priority: 'normal' })).toBe(false);
    expect(isUrgent({ priority: null })).toBe(false);
  });
});

describe('planDay', () => {
  const jobs = [
    job({ id: '1', scheduledTime: '14:00', status: 'accepted' }),
    job({ id: '2', scheduledTime: '09:00', status: 'completed' }),
    job({ id: '3', scheduledTime: '11:00', status: 'in_progress' }),
    job({ id: '4', scheduledTime: '12:00', status: 'assigned' }),
    job({ id: '5', scheduledTime: '13:00', status: 'incomplete' }),
    job({ id: '6', scheduledDate: '2026-10-09' }),
    job({ id: '7', status: 'declined' }),
    job({ id: '8', status: 'pending_send' }),
  ];
  const plan = planDay(jobs, '2026-10-08');

  it('keeps the day in time order and leaves out other days, declined and unsent jobs', () => {
    expect(plan.jobs.map((j) => j.id)).toEqual(['2', '3', '4', '5', '1']);
    expect(plan.total).toBe(5);
  });

  it('counts done, not completed, underway, waiting and remaining', () => {
    expect(plan).toMatchObject({ done: 1, notCompleted: 1, underway: 1, waiting: 1, remaining: 3 });
  });

  it('picks the job under way as next, else the first accepted', () => {
    expect(plan.next?.id).toBe('3');
    expect(planDay([job({ id: 'x', status: 'accepted' })], '2026-10-08').next?.id).toBe('x');
    expect(planDay([job({ id: 'y', status: 'assigned' })], '2026-10-08').next).toBeNull();
  });

  it('is empty on a day with nothing', () => {
    expect(planDay(jobs, '2026-01-01')).toMatchObject({ total: 0, remaining: 0, next: null });
  });
});

describe('dayCounts / urgentDays', () => {
  const jobs = [
    job({ id: '1', priority: 'high' }),
    job({ id: '2', scheduledDate: '2026-10-08' }),
    job({ id: '3', scheduledDate: '2026-10-09', status: 'declined' }),
    job({ id: '4', scheduledDate: null }),
    job({ id: '5', scheduledDate: '2026-10-10', status: 'pending_send' }),
  ];
  it('counts per day and ignores undated, declined and unsent jobs', () => {
    expect(dayCounts(jobs)).toEqual({ '2026-10-08': 2 });
  });
  it('marks days with an urgent job', () => {
    expect([...urgentDays(jobs)]).toEqual(['2026-10-08']);
  });
});

describe('mapJobRow', () => {
  it('maps a row, taking the first line of the description as the title', () => {
    const mapped = mapJobRow({
      id: 'j',
      reference_number: 'J-9',
      job_description: '\n  Fit new cylinder  \nsecond line',
      status: 'accepted',
      priority: 'emergency',
      scheduled_date: '2026-10-08',
      scheduled_time: '09:30:00',
      address: ' 2 Road ',
      postcode: 'ZZ1 1ZZ',
      completed_at: null,
      customers: [{ name: ' Sam ' }],
    });
    expect(mapped).toMatchObject({
      title: 'Fit new cylinder',
      scheduledTime: '09:30',
      address: '2 Road',
      customerName: 'Sam',
      priority: 'emergency',
    });
  });

  it('drops a row whose status it does not know', () => {
    expect(
      mapJobRow({ id: 'j', reference_number: null, job_description: 'x', status: 'mystery', priority: null, scheduled_date: null, scheduled_time: null, address: null, postcode: null, completed_at: null }),
    ).toBeNull();
  });

  it('shortens long titles and survives an empty description', () => {
    expect(titleFromDescription('x'.repeat(200)).length).toBeLessThanOrEqual(90);
    expect(titleFromDescription('   ')).toBe('Job');
    expect(titleFromDescription(null)).toBe('Job');
  });

  it('formats times', () => {
    expect(hhmm('07:05:00')).toBe('07:05');
    expect(hhmm(null)).toBeNull();
    expect(hhmm('bad')).toBeNull();
  });
});

describe('blockedReason / historyLines', () => {
  it('reads text, lists of text and lists of objects', () => {
    expect(blockedReason({ blocked_by: 'No access' })).toBe('No access');
    expect(blockedReason({ blocked_by: ['No access', 'Dog'] })).toBe('No access, Dog');
    expect(blockedReason({ blocked_by: [{ label: 'Customer away' }, { question: 'Key missing?' }] })).toBe(
      'Customer away, Key missing?',
    );
  });
  it('returns null for missing or odd metadata', () => {
    expect(blockedReason(null)).toBeNull();
    expect(blockedReason({})).toBeNull();
    expect(blockedReason({ blocked_by: 5 })).toBeNull();
    expect(blockedReason([])).toBeNull();
  });
  it('turns history into oldest-first lines, with the reason on not completed', () => {
    const lines = historyLines([
      { to_status: 'incomplete', created_at: '2026-10-08T12:00:00Z', metadata: { blocked_by: 'No access' } },
      { to_status: 'assigned', created_at: '2026-10-08T08:00:00Z' },
      { to_status: 'pending_send', created_at: '2026-10-08T07:00:00Z' },
      { to_status: 'in_progress', created_at: null },
    ]);
    expect(lines).toEqual([
      { at: '2026-10-08T08:00:00Z', label: 'Sent to you' },
      { at: '2026-10-08T12:00:00Z', label: 'Not completed: No access' },
    ]);
  });
});

describe('parseJobsTab', () => {
  it('falls back to upcoming', () => {
    expect(parseJobsTab('done')).toBe('done');
    expect(parseJobsTab('nonsense')).toBe('upcoming');
    expect(parseJobsTab(undefined)).toBe('upcoming');
  });
});
