import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateAgreementCore = vi.fn(async (..._args: unknown[]) => ({ success: true as const, regenerated: 0 }));
vi.mock('@/lib/rounds/update-agreement', () => ({ updateAgreementCore: (...args: unknown[]) => updateAgreementCore(...args) }));
vi.mock('@/lib/rounds/generate-visits', () => ({
  AGREEMENT_COLUMNS: 'id',
  mapAgreementRow: (raw: Record<string, unknown>) => raw,
}));

import { setCustomerHouseCore } from '@/lib/rounds/customer-house';

type Row = Record<string, unknown>;

function agreement(id: string, address: string, postcode: string, status = 'active'): Row {
  return {
    id,
    customer_id: 'c1',
    service_catalog_id: null,
    title: `Service ${id}`,
    address,
    postcode,
    status,
    price: 10,
    duration_minutes: 30,
    frequency_days: 28,
    schedule_mode: 'fixed',
    anchor_date: '2026-10-01',
    preferred_weekday: null,
    preferred_time: null,
    default_payment_method: null,
    reminder_enabled: true,
    access_notes: null,
    notes: null,
  };
}

function fakeSupabase(billingAddress: string | null, agreements: Row[]) {
  const customerUpdates: Row[] = [];
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    c.eq = () => c;
    c.maybeSingle = async () => ({ data: result, error: null });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: result, error: null });
    return c;
  };
  return {
    customerUpdates,
    client: {
      from(table: string) {
        if (table === 'customers') {
          return {
            select: () => chain({ billing_address: billingAddress }),
            update: (patch: Row) => {
              customerUpdates.push(patch);
              return chain(null);
            },
          };
        }
        return { select: () => chain(agreements) };
      },
    },
  };
}

const baseParams = { tenantId: 't1', customerId: 'c1' };

describe('setCustomerHouseCore', () => {
  beforeEach(() => updateAgreementCore.mockClear());

  it('moves the services that are at the old address and leaves another property alone', async () => {
    const db = fakeSupabase('12 Elm Road, M3 2ER', [
      agreement('a', '12 Elm Road', 'M3 2ER'),
      agreement('b', '4 Oak Lane', 'LS1 4AB'),
    ]);
    const result = await setCustomerHouseCore(db.client as never, { ...baseParams, address: '14 Elm Road', postcode: 'M3 2ER' });
    expect(result).toEqual({ success: true });
    expect(updateAgreementCore).toHaveBeenCalledTimes(1);
    const call = updateAgreementCore.mock.calls[0]![1] as { agreementId: string; values: { address: string } };
    expect(call.agreementId).toBe('a');
    expect(call.values.address).toBe('14 Elm Road');
  });

  it('saving the same address changes nothing, even with a second property', async () => {
    const db = fakeSupabase('12 Elm Road, M3 2ER', [
      agreement('a', '12 Elm Road', 'M3 2ER'),
      agreement('b', '4 Oak Lane', 'LS1 4AB'),
    ]);
    await setCustomerHouseCore(db.client as never, { ...baseParams, address: '12 Elm Road', postcode: 'M3 2ER' });
    expect(updateAgreementCore).not.toHaveBeenCalled();
  });

  it('passes a dropped pin to the services that move, and applies it even when the text is the same', async () => {
    const db = fakeSupabase('12 Elm Road, M3 2ER', [agreement('a', '12 Elm Road', 'M3 2ER'), agreement('b', '4 Oak Lane', 'LS1 4AB')]);
    await setCustomerHouseCore(db.client as never, {
      ...baseParams,
      address: '12 Elm Road',
      postcode: 'M3 2ER',
      pin: { lat: 53.48, lng: -2.24 },
    });
    expect(updateAgreementCore).toHaveBeenCalledTimes(1);
    const call = updateAgreementCore.mock.calls[0]![1] as { agreementId: string; values: { pin_lat: number; pin_lng: number } };
    expect(call.agreementId).toBe('a');
    expect(call.values.pin_lat).toBe(53.48);
    expect(call.values.pin_lng).toBe(-2.24);
  });

  it('for a customer with no stored address, the first service stands in as the old address', async () => {
    const db = fakeSupabase(null, [agreement('a', '12 Elm Road', 'M3 2ER'), agreement('b', '4 Oak Lane', 'LS1 4AB')]);
    await setCustomerHouseCore(db.client as never, { ...baseParams, address: '14 Elm Road', postcode: 'M3 2ER' });
    expect(updateAgreementCore).toHaveBeenCalledTimes(1);
    expect((updateAgreementCore.mock.calls[0]![1] as { agreementId: string }).agreementId).toBe('a');
  });

  it('skips services that have ended', async () => {
    const db = fakeSupabase('12 Elm Road, M3 2ER', [agreement('a', '12 Elm Road', 'M3 2ER', 'ended')]);
    await setCustomerHouseCore(db.client as never, { ...baseParams, address: '14 Elm Road', postcode: 'M3 2ER' });
    expect(updateAgreementCore).not.toHaveBeenCalled();
  });
});
