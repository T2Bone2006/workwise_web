import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const afterManualPayment = vi.fn();
vi.mock('@/lib/payments/notify', () => ({ afterManualPayment: (...a: unknown[]) => afterManualPayment(...a) }));

import { getStaffCash, getStaffCustomer, recordStaffPayment } from '@/lib/team/staff-cash';
import { fakeDb, type FakeDb } from './fake-db';

const T = 't1';
const base = { tenantId: T, workerId: 'w-dave', name: 'Dave', userId: 'u-dave', today: '2026-10-13' };

function seed(): FakeDb {
  return fakeDb(
    {
      customers: [
        { id: 'c1', tenant_id: T, name: 'Mrs Patel', phone: '07700900111', email: 'p@example.com', access_notes: ' Gate 4471 ' },
        { id: 'c2', tenant_id: T, name: 'Mr Jones' },
        { id: 'c3', tenant_id: T, name: 'Not Mine' },
      ],
      jobs: [
        { id: 'j1', tenant_id: T, assigned_worker_id: 'w-dave', customer_id: 'c1', scheduled_date: '2026-10-13', address: '12 Oak Road', postcode: 'LS6 1AA', job_description: 'Windows\nx' },
        { id: 'j2', tenant_id: T, assigned_worker_id: 'w-dave', customer_id: 'c2', scheduled_date: '2025-01-01', address: 'Old', postcode: 'LS1' },
        { id: 'j3', tenant_id: T, assigned_worker_id: 'w-lee', customer_id: 'c3', scheduled_date: '2026-10-13', address: 'Lee’s', postcode: 'LS2' },
      ],
      customer_balances: [{ tenant_id: T, customer_id: 'c1', owed_amount: '20.00' }],
      payments: [
        { id: 'p1', tenant_id: T, customer_id: 'c1', amount: 20, method: 'cash', status: 'active', received_at: '2026-10-13T09:00:00Z', applies_to_job_id: 'j1', collected_by_worker_id: 'w-dave', handed_over_at: null },
        { id: 'p2', tenant_id: T, customer_id: 'c2', amount: '5.50', method: 'cheque', status: 'active', received_at: '2026-10-12T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: 'w-dave', handed_over_at: null },
        { id: 'p3', tenant_id: T, customer_id: 'c1', amount: 30, method: 'cash', status: 'active', received_at: '2026-10-01T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: 'w-dave', handed_over_at: '2026-10-03T10:00:00Z' },
        { id: 'p4', tenant_id: T, customer_id: 'c3', amount: 99, method: 'cash', status: 'active', received_at: '2026-10-13T09:00:00Z', applies_to_job_id: 'j3', collected_by_worker_id: 'w-lee', handed_over_at: null },
        { id: 'p5', tenant_id: T, customer_id: 'c1', amount: 77, method: 'cash', status: 'void', received_at: '2026-10-13T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: 'w-dave', handed_over_at: null },
        { id: 'p6', tenant_id: 'other', customer_id: 'c1', amount: 55, method: 'cash', status: 'active', received_at: '2026-10-13T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: 'w-dave', handed_over_at: null },
      ],
    },
  );
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
  afterManualPayment.mockReset();
});

describe('getStaffCash', () => {
  it('lists only their own live, un-handed-over payments as held, newest first', async () => {
    const cash = await getStaffCash(db.client, { tenantId: T, workerId: 'w-dave' });
    expect(cash.held.map((h) => h.paymentId)).toEqual(['p1', 'p2']);
    expect(cash.held[0]).toEqual({ paymentId: 'p1', customerName: 'Mrs Patel', amount: 20, method: 'cash', receivedAt: '2026-10-13T09:00:00Z', visitTitle: 'Windows' });
    expect(cash.held[1]).toMatchObject({ method: 'cheque', amount: 5.5, visitTitle: null });
    expect(cash.heldTotal).toBe(25.5);
  });

  it('shows what they handed over recently, and nothing of anyone else’s, voided or other businesses’ payments', async () => {
    const cash = await getStaffCash(db.client, { tenantId: T, workerId: 'w-dave' });
    expect(cash.recentlyHandedOver).toEqual([{ amount: 30, customerName: 'Mrs Patel', handedOverAt: '2026-10-03T10:00:00Z' }]);
    expect(cash.held.some((h) => ['p4', 'p5', 'p6'].includes(h.paymentId))).toBe(false);
  });
});

describe('recordStaffPayment', () => {
  const recorded = () => db.rows('payments').filter((p) => p.client_mutation_id === 'mut-12345678');

  beforeEach(() => {
    db.rpcHandlers = {};
  });

  it('holds the payment for the member of staff, thanks the customer, and refuses nothing it should accept', async () => {
    const r = await recordStaffPayment(db.client, { ...base, customerId: 'c1', amount: 14, method: 'cash', appliesToJobId: 'j1', clientMutationId: 'mut-12345678' });
    expect(r).toMatchObject({ success: true, duplicate: false });
    expect(recorded()[0]).toMatchObject({
      tenant_id: T, customer_id: 'c1', amount: 14, method: 'cash', applies_to_job_id: 'j1',
      collected_by_worker_id: 'w-dave', collected_by_name: 'Dave', recorded_by_user_id: 'u-dave',
    });
    expect(afterManualPayment).toHaveBeenCalledOnce();
  });

  it('only from their own customers: not one that is another person’s, nor one they have not visited in 90 days', async () => {
    for (const customerId of ['c3', 'c2']) {
      const r = await recordStaffPayment(db.client, { ...base, customerId, amount: 5, method: 'cash' });
      expect(r).toEqual({ success: false, error: 'You can only take payment from your own customers.' });
    }
    expect(db.rows('payments').filter((p) => p.amount === 5)).toHaveLength(0);
  });

  it('refuses a visit that is not theirs or not that customer’s', async () => {
    const wrongJob = await recordStaffPayment(db.client, { ...base, customerId: 'c1', amount: 5, method: 'cash', appliesToJobId: 'j3' });
    expect(wrongJob).toEqual({ success: false, error: 'You can only take payment from your own customers.' });
  });

  it('limits the amount to £0.01 – £1,000', async () => {
    expect((await recordStaffPayment(db.client, { ...base, customerId: 'c1', amount: 0, method: 'cash' })).success).toBe(false);
    expect((await recordStaffPayment(db.client, { ...base, customerId: 'c1', amount: 1000.01, method: 'cash' })).success).toBe(false);
    expect((await recordStaffPayment(db.client, { ...base, customerId: 'c1', amount: 1000, method: 'cheque' })).success).toBe(true);
  });
});

describe('getStaffCustomer', () => {
  it('shows a customer on their visits with the phone, address, notes and what they owe', async () => {
    expect(await getStaffCustomer(db.client, { tenantId: T, workerId: 'w-dave', customerId: 'c1' })).toEqual({
      id: 'c1', name: 'Mrs Patel', phone: '07700900111', email: 'p@example.com',
      address: '12 Oak Road', postcode: 'LS6 1AA', accessNotes: 'Gate 4471', customerOwes: 20,
    });
  });
  it('is null for a customer on someone else’s visits, or one that does not exist', async () => {
    expect(await getStaffCustomer(db.client, { tenantId: T, workerId: 'w-dave', customerId: 'c3' })).toBeNull();
    expect(await getStaffCustomer(db.client, { tenantId: T, workerId: 'w-dave', customerId: 'nope' })).toBeNull();
  });
});
