import { describe, expect, it } from 'vitest';
import { agreementSchema, doorstepCustomerSchema } from '@/lib/validations/rounds/agreement';
import { serviceSchema } from '@/lib/validations/rounds/service';
import { roundsSettingsSchema } from '@/lib/validations/rounds/settings';
import {
  completeVisitSchema,
  moveRemainingSchema,
  oneOffVisitSchema,
  reorderDaySchema,
  skipVisitSchema,
} from '@/lib/validations/rounds/visit';

const validAgreement = {
  customer_id: '11111111-1111-4111-8111-111111111111',
  title: 'Window clean (front)',
  address: '12 Elm Road',
  postcode: 'sw1a1aa',
  price: 18,
  frequency_days: 28,
  anchor_date: '2026-09-18',
};

describe('agreementSchema', () => {
  it('defaults schedule_mode to fixed and reminder_enabled to true', () => {
    const parsed = agreementSchema.parse(validAgreement);
    expect(parsed.schedule_mode).toBe('fixed');
    expect(parsed.reminder_enabled).toBe(true);
    expect(parsed.duration_minutes).toBe(30);
    expect(parsed.postcode).toBe('SW1A 1AA');
  });

  it('accepts after_completion', () => {
    const parsed = agreementSchema.parse({
      ...validAgreement,
      schedule_mode: 'after_completion',
    });
    expect(parsed.schedule_mode).toBe('after_completion');
  });

  it('rejects an unknown schedule_mode', () => {
    const result = agreementSchema.safeParse({
      ...validAgreement,
      schedule_mode: 'rolling',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an impossible calendar date', () => {
    const result = agreementSchema.safeParse({
      ...validAgreement,
      anchor_date: '2026-02-31',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid postcode', () => {
    const result = agreementSchema.safeParse({
      ...validAgreement,
      postcode: 'not-a-postcode',
    });
    expect(result.success).toBe(false);
  });
});

describe('doorstepCustomerSchema', () => {
  it('requires name and phone and still defaults schedule_mode to fixed', () => {
    const parsed = doorstepCustomerSchema.parse({
      name: 'Jane Smith',
      phone: '07700900123',
      title: 'Regular visit',
      address: '12 Elm Road',
      postcode: 'SW1A 1AA',
      price: 15,
      frequency_days: 28,
      anchor_date: '2026-09-18',
    });
    expect(parsed.schedule_mode).toBe('fixed');
    expect(parsed.name).toBe('Jane Smith');
  });

  it('rejects a missing name', () => {
    const result = doorstepCustomerSchema.safeParse({
      phone: '07700900123',
      title: 'Regular visit',
      address: '12 Elm Road',
      postcode: 'SW1A 1AA',
      price: 15,
      frequency_days: 28,
      anchor_date: '2026-09-18',
    });
    expect(result.success).toBe(false);
  });
});

describe('visit schemas', () => {
  it('accepts a user skip reason and rejects a system one', () => {
    expect(
      skipVisitSchema.parse({
        jobId: '11111111-1111-4111-8111-111111111111',
        reason: 'no_access',
      }).reason
    ).toBe('no_access');

    const system = skipVisitSchema.safeParse({
      jobId: '11111111-1111-4111-8111-111111111111',
      reason: 'agreement_paused',
    });
    expect(system.success).toBe(false);
  });

  it('parses move remaining dates', () => {
    const parsed = moveRemainingSchema.parse({
      fromDate: '2026-09-18',
      toDate: '2026-09-21',
      scheduledTime: '',
    });
    expect(parsed.fromDate).toBe('2026-09-18');
    expect(parsed.toDate).toBe('2026-09-21');
  });

  it('parses complete + reorder + one-off', () => {
    expect(
      completeVisitSchema.parse({
        jobId: '11111111-1111-4111-8111-111111111111',
        finalAmount: '18.50',
      }).finalAmount
    ).toBe(18.5);

    expect(
      reorderDaySchema.parse({
        date: '2026-09-18',
        jobIds: ['11111111-1111-4111-8111-111111111111'],
      }).jobIds
    ).toHaveLength(1);

    const oneOff = oneOffVisitSchema.parse({
      customer_id: '11111111-1111-4111-8111-111111111111',
      title: 'Call-out',
      address: '12 Elm Road',
      postcode: 'SW1A 1AA',
      price: 40,
      scheduled_date: '2026-09-18',
      scheduled_time: '09:30',
    });
    expect(oneOff.duration_minutes).toBe(30);
    expect(oneOff.scheduled_time).toBe('09:30');
  });
});

describe('serviceSchema', () => {
  it('defaults is_active to true', () => {
    const parsed = serviceSchema.parse({
      name: 'Window clean (front)',
      default_price: 12,
      default_duration_minutes: 20,
      default_frequency_days: 28,
    });
    expect(parsed.is_active).toBe(true);
  });
});

describe('roundsSettingsSchema', () => {
  it('defaults shift_off_non_working_days to false', () => {
    const parsed = roundsSettingsSchema.parse({
      horizon_weeks: 8,
      reminder_days_before: 3,
      working_days: [1, 2, 3, 4, 5],
      blackouts: ['2026-12-25'],
      start_postcode: null,
    });
    expect(parsed.shift_off_non_working_days).toBe(false);
  });

  it('rejects an empty working_days list and a bad blackout', () => {
    expect(
      roundsSettingsSchema.safeParse({
        horizon_weeks: 8,
        reminder_days_before: 3,
        working_days: [],
        blackouts: [],
        start_postcode: null,
      }).success
    ).toBe(false);

    expect(
      roundsSettingsSchema.safeParse({
        horizon_weeks: 8,
        reminder_days_before: 3,
        working_days: [1],
        blackouts: ['2026-13-01'],
        start_postcode: null,
      }).success
    ).toBe(false);
  });
});
