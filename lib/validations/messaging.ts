import { z } from 'zod';
import { isValidYmd } from '@/lib/rounds/dates';

export const actOnReplySchema = z.object({
  threadId: z.string().uuid(),
  action: z.enum(['skip', 'keep', 'move', 'dismiss']),
  toDate: z.string().refine(isValidYmd, { message: 'Invalid date' }).nullable().optional(),
  letThemKnow: z.boolean().optional(),
});

export const messagingSettingsSchema = z
  .object({
    reminders_enabled: z.boolean(),
    reminder_days_before: z.coerce
      .number()
      .int()
      .min(1, 'Must be 1–7')
      .max(7, 'Must be 1–7'),
    money_channel: z.enum(['email_first', 'text_first']),
    change_channel: z.enum(['email_first', 'text_first']),
    chasers_enabled: z.boolean(),
    // Optional so an older phone saving settings without it keeps the default.
    payment_thanks_enabled: z.boolean().optional(),
    chase_first_days: z.coerce.number().int().min(3).max(30),
    chase_second_days: z.coerce.number().int().min(4).max(60),
    contact_phone: z.string().trim().max(20).nullable(),
  })
  .refine((v) => v.chase_second_days > v.chase_first_days, {
    message: 'Second reminder must be after the first',
    path: ['chase_second_days'],
  });

export const customerMessagingSchema = z.object({
  customerId: z.string().uuid(),
  visitReminders: z.boolean().optional(),
  paymentChasers: z.boolean().optional(),
  paymentThanks: z.boolean().optional(),
  contactChoice: z.enum(['default', 'sms', 'email', 'none']).optional(),
});
