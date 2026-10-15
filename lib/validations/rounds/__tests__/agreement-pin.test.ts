import { describe, expect, it } from 'vitest';
import { agreementSchema } from '@/lib/validations/rounds/agreement';

const valid = {
  customer_id: '11111111-1111-4111-8111-111111111111',
  title: 'Window clean (front)',
  address: '12 Elm Road',
  postcode: 'sw1a1aa',
  price: 18,
  frequency_days: 28,
  anchor_date: '2026-09-18',
};

describe('agreementSchema pin', () => {
  it('is optional', () => {
    const parsed = agreementSchema.parse(valid);
    expect(parsed.pin_lat).toBeUndefined();
    expect(parsed.pin_lng).toBeUndefined();
  });

  it('keeps null as null (not zero)', () => {
    const parsed = agreementSchema.parse({ ...valid, pin_lat: null, pin_lng: null });
    expect(parsed.pin_lat).toBeNull();
    expect(parsed.pin_lng).toBeNull();
  });

  it('accepts a spot in the UK, including numbers sent as text', () => {
    const parsed = agreementSchema.parse({ ...valid, pin_lat: '53.4808', pin_lng: -2.2426 });
    expect(parsed.pin_lat).toBeCloseTo(53.4808);
    expect(parsed.pin_lng).toBeCloseTo(-2.2426);
  });

  it('rejects a spot far outside the UK', () => {
    expect(agreementSchema.safeParse({ ...valid, pin_lat: 40.7, pin_lng: -74 }).success).toBe(false);
  });
});
