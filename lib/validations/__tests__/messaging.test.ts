import { describe, expect, it } from 'vitest';
import {
  actOnReplySchema,
  customerMessagingSchema,
  messagingSettingsSchema,
} from '@/lib/validations/messaging';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

const validSettings = {
  reminders_enabled: true,
  reminder_days_before: 3,
  money_channel: 'email_first' as const,
  change_channel: 'text_first' as const,
  chasers_enabled: true,
  chase_first_days: 7,
  chase_second_days: 21,
  contact_phone: null,
};

describe('messagingSettingsSchema', () => {
  it('rejects reminder_days_before 0 and 8, and chase_second_days on or before chase_first_days', () => {
    expect(messagingSettingsSchema.safeParse(validSettings).success).toBe(true);
    expect(
      messagingSettingsSchema.safeParse({ ...validSettings, reminder_days_before: 0 }).success,
    ).toBe(false);
    expect(
      messagingSettingsSchema.safeParse({ ...validSettings, reminder_days_before: 8 }).success,
    ).toBe(false);

    const equal = messagingSettingsSchema.safeParse({
      ...validSettings,
      chase_first_days: 7,
      chase_second_days: 7,
    });
    expect(equal.success).toBe(false);
    if (!equal.success) {
      expect(equal.error.issues.map((issue) => issue.message)).toContain(
        'Second reminder must be after the first',
      );
    }

    expect(
      messagingSettingsSchema.safeParse({
        ...validSettings,
        chase_first_days: 10,
        chase_second_days: 8,
      }).success,
    ).toBe(false);
  });
});

describe('actOnReplySchema', () => {
  it('accepts move without toDate', () => {
    const parsed = actOnReplySchema.parse({
      threadId: CUSTOMER_ID,
      action: 'move',
    });
    expect(parsed.action).toBe('move');
    expect(parsed.toDate).toBeUndefined();
  });
});

describe('customerMessagingSchema', () => {
  it('accepts only customerId', () => {
    const parsed = customerMessagingSchema.parse({ customerId: CUSTOMER_ID });
    expect(parsed.customerId).toBe(CUSTOMER_ID);
    expect(parsed.visitReminders).toBeUndefined();
    expect(parsed.paymentChasers).toBeUndefined();
    expect(parsed.contactChoice).toBeUndefined();
  });
});
