import { describe, expect, it } from 'vitest';
import { recordPaymentCore } from '@/lib/payments/money-core';
import { fakeDb } from '../../team/__tests__/fake-db';

const base = { tenantId: 't1', customerId: 'c1', amount: 20, userId: 'u1' };
const seed = () => fakeDb({ customers: [{ id: 'c1', tenant_id: 't1' }] });

describe('recordPaymentCore with collectedBy', () => {
  it('saves cash and cheques as held by the member of staff, keeping their name', async () => {
    const db = seed();
    const r = await recordPaymentCore(db.client, { ...base, method: 'cash', collectedBy: { workerId: 'w1', name: '  Dave  ' } });
    expect(r.success).toBe(true);
    expect(db.rows('payments')[0]).toMatchObject({ collected_by_worker_id: 'w1', collected_by_name: 'Dave', method: 'cash' });
    const c = await recordPaymentCore(db.client, { ...base, method: 'cheque', collectedBy: { workerId: 'w1', name: 'Dave' } });
    expect(c.success).toBe(true);
  });

  it('refuses to hold a card, bank or Direct Debit payment', async () => {
    const db = seed();
    for (const method of ['card', 'bank_transfer', 'direct_debit'] as const) {
      expect(await recordPaymentCore(db.client, { ...base, method, collectedBy: { workerId: 'w1', name: 'Dave' } })).toEqual({
        success: false,
        error: 'Only cash and cheques can be held.',
      });
    }
    expect(db.rows('payments')).toHaveLength(0);
  });

  it('leaves the owner’s own payments exactly as before (no collector)', async () => {
    const db = seed();
    await recordPaymentCore(db.client, { ...base, method: 'cash' });
    const row = db.rows('payments')[0];
    expect(row).not.toHaveProperty('collected_by_worker_id');
    expect(row).not.toHaveProperty('collected_by_name');
  });
});
