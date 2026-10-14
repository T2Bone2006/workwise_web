import { describe, expect, it } from 'vitest';
import { mapJobRow, roundsPrice, type JobRowForWorker } from '../map-job';
import { planDay } from '../day-plan';
import { workerTag } from '../status';

const row: JobRowForWorker = {
  id: 'j1',
  reference_number: 'VR-1001',
  job_description: 'Windows, front and back',
  status: 'assigned',
  priority: 'normal',
  scheduled_date: '2026-10-19',
  scheduled_time: '09:00:00',
  address: '14 Oak Road',
  postcode: 'LS6 1AA',
  completed_at: null,
  quoted_amount: 18,
  customers: { name: 'Margaret Ellis' },
};

describe('mapJobRow for a Pro employee (regression)', () => {
  it('is exactly what it was: no price, no Rounds flag, even though the price was read', () => {
    const job = mapJobRow(row)!;
    expect(job).toEqual({
      id: 'j1',
      referenceNumber: 'VR-1001',
      title: 'Windows, front and back',
      status: 'assigned',
      priority: 'normal',
      scheduledDate: '2026-10-19',
      scheduledTime: '09:00',
      address: '14 Oak Road',
      postcode: 'LS6 1AA',
      customerName: 'Margaret Ellis',
      completedAt: null,
      notBecause: null,
    });
    expect('price' in job).toBe(false);
    expect('rounds' in job).toBe(false);
  });
  it('an assigned Pro job still says Waiting for you and counts as waiting', () => {
    const job = mapJobRow(row)!;
    expect(workerTag(job)).toEqual({ label: 'Waiting for you', tone: 'sky' });
    expect(planDay([job], '2026-10-19').waiting).toBe(1);
  });
});

describe('mapJobRow for a Rounds lead', () => {
  it('carries the price and the Rounds flag', () => {
    const job = mapJobRow(row, null, { rounds: true })!;
    expect(job).toMatchObject({ rounds: true, price: 18 });
  });
  it('a visit with no price is null, never £0 or NaN', () => {
    expect(mapJobRow({ ...row, quoted_amount: null }, null, { rounds: true })!.price).toBeNull();
    expect(mapJobRow({ ...row, quoted_amount: 0 }, null, { rounds: true })!.price).toBeNull();
    expect(mapJobRow({ ...row, quoted_amount: 'abc' }, null, { rounds: true })!.price).toBeNull();
    expect(roundsPrice('12.50')).toBe(12.5);
  });
  it('an assigned visit is Planned, not waiting, and can be next', () => {
    const job = mapJobRow(row, null, { rounds: true })!;
    expect(workerTag(job)).toEqual({ label: 'Planned', tone: 'slate' });
    const plan = planDay([job], '2026-10-19');
    expect(plan.waiting).toBe(0);
    expect(plan.next?.id).toBe('j1');
  });
});
