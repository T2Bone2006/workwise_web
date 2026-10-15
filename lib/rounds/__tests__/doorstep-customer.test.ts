import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const createAgreementCore = vi.fn();
const jobIdsForAgreement = vi.fn();
vi.mock('@/lib/rounds/create-agreement', () => ({
  createAgreementCore: (...a: unknown[]) => createAgreementCore(...a),
  jobIdsForAgreement: (...a: unknown[]) => jobIdsForAgreement(...a),
}));

import { createDoorstepCustomerCore } from '@/lib/rounds/doorstep-customer';
import { fakeDb, type FakeDb } from '../../team/__tests__/fake-db';

const T = 't1';
const body = {
  name: 'Mrs Patel',
  phone: '07700900111',
  address: '12 Oak Road',
  postcode: 'LS6 1AA',
  price: 14,
  frequency_days: 28,
  title: 'Windows',
};

let db: FakeDb;
beforeEach(() => {
  db = fakeDb();
  createAgreementCore.mockReset();
  jobIdsForAgreement.mockReset();
  createAgreementCore.mockResolvedValue({ success: true, id: 'a1', generated: 3 });
  jobIdsForAgreement.mockResolvedValue(['j1', 'j2']);
});

describe('createDoorstepCustomerCore', () => {
  it('for the owner: makes the customer and agreement and marks nobody as the adder', async () => {
    const r = await createDoorstepCustomerCore(db.client, { tenantId: T, body });
    expect(r).toMatchObject({ ok: true, agreementId: 'a1', jobIds: ['j1', 'j2'] });
    const customer = db.rows('customers')[0];
    expect(customer).toMatchObject({ tenant_id: T, name: 'Mrs Patel', phone: '07700900111', type: 'individual' });
    expect(customer).not.toHaveProperty('added_by_worker_id');
    expect(createAgreementCore.mock.calls[0][1].assignedWorkerId).toBeNull();
  });

  it('for a member of staff: marks the customer as added by them and gives them the agreement', async () => {
    const r = await createDoorstepCustomerCore(db.client, { tenantId: T, body, addedByWorkerId: 'w-dave', assignWorkerId: 'w-dave' });
    expect(r.ok).toBe(true);
    expect(db.rows('customers')[0]).toMatchObject({ added_by_worker_id: 'w-dave' });
    expect(createAgreementCore.mock.calls[0][1].assignedWorkerId).toBe('w-dave');
  });

  it('takes the service name from the catalogue when no title was given', async () => {
    const CAT = '33333333-3333-4333-8333-333333333333';
    db.rows('service_catalog').push({ id: CAT, tenant_id: T, name: 'Gutter clean' });
    await createDoorstepCustomerCore(db.client, { tenantId: T, body: { ...body, title: '', service_catalog_id: CAT } });
    expect(createAgreementCore.mock.calls[0][1].values.title).toBe('Gutter clean');
  });

  it('removes the customer again if the service cannot be created', async () => {
    createAgreementCore.mockResolvedValue({ success: false, error: 'No visits' });
    expect(await createDoorstepCustomerCore(db.client, { tenantId: T, body })).toEqual({ ok: false, status: 400, error: 'No visits' });
    expect(db.rows('customers')).toHaveLength(0);
  });

  it('answers a bad form with the first problem, creating nothing', async () => {
    const r = await createDoorstepCustomerCore(db.client, { tenantId: T, body: { ...body, price: -1 } });
    expect(r.ok).toBe(false);
    expect(db.rows('customers')).toHaveLength(0);
    expect(createAgreementCore).not.toHaveBeenCalled();
  });
});
