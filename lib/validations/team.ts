import { z } from 'zod';
import { isValidYmd } from '@/lib/rounds/dates';
import { penceFromPounds } from '@/lib/team/types';

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(80, 'That name is too long.');

/**
 * A day rate typed in pounds (0–1000, pence allowed). The PARSED value is PENCE, even though the field is called
 * dayRatePounds (that is what the form sends): never divide or multiply it again.
 */
export const dayRateSchema = z.coerce
  .number({ message: 'Enter a day rate.' })
  .min(0, 'The day rate can’t be below £0.')
  .max(1000, 'The day rate can’t be above £1,000.')
  .transform(penceFromPounds);

export const usualDaysSchema = z
  .array(z.coerce.number().int().min(1).max(7))
  .max(7)
  .transform((days) => Array.from(new Set(days)).sort((a, b) => a - b))
  .default([1, 2, 3, 4, 5]);

export const helperSchema = z.object({
  name: nameSchema,
  dayRatePounds: dayRateSchema,
  usualDays: usualDaysSchema,
});
export type HelperInput = z.output<typeof helperSchema>;

export const rateSchema = z.object({
  personId: z.string().uuid('Invalid person'),
  dayRatePounds: dayRateSchema,
});

export const personUsualDaysSchema = z.object({
  personId: z.string().uuid('Invalid person'),
  usualDays: usualDaysSchema,
});

export const dayOffSchema = z
  .object({
    workerId: z.string().uuid('Invalid person'),
    from: z.string().refine(isValidYmd, { message: 'Pick a valid start date.' }),
    to: z.string().refine(isValidYmd, { message: 'Pick a valid end date.' }),
    note: z.string().trim().max(200).optional().or(z.literal('')),
  })
  .refine((v) => v.to >= v.from, { message: 'The last day can’t be before the first day.', path: ['to'] });
export type DayOffInput = z.output<typeof dayOffSchema>;

/** A UK mobile or landline, the same shape the Pro worker form accepts. */
export const teamPhoneSchema = z
  .string()
  .trim()
  .regex(/^(\+44|0)[0-9\s]{10,13}$/, 'Enter a UK phone number.');

/** Inviting a lead: no postcode, no skills, no worker type (a lead is always an employee). */
export const leadInviteSchema = z.object({
  name: nameSchema,
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: teamPhoneSchema,
  dayRatePounds: dayRateSchema,
  usualDays: usualDaysSchema,
  /** The per-lead price in pence the owner was shown and agreed to (1000 or 10000). */
  confirmedPriceCents: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type LeadInvite = z.output<typeof leadInviteSchema>;

export const startDaySchema = z.object({
  /** The London date the phone shows. */
  date: z.string().refine(isValidYmd, { message: 'Pick a valid date.' }),
  /** People with them today: helpers, or another lead who is helping. Never themselves. May be empty. */
  helperIds: z.array(z.string().uuid('Invalid person')).max(10),
  clientMutationId: z.string().min(8).max(64).optional(),
});
export type StartDayInput = z.output<typeof startDaySchema>;

export const staffPaymentSchema = z.object({
  customerId: z.string().uuid('Invalid customer'),
  amount: z.coerce.number().min(0.01, 'Enter an amount.').max(1000, 'That is more than you can take in one go.'),
  method: z.enum(['cash', 'cheque']),
  appliesToJobId: z.string().uuid('Invalid visit').nullable().optional(),
  clientMutationId: z.string().min(8).max(64).optional(),
});

export const handOverSchema = z
  .object({
    paymentIds: z.array(z.string().uuid('Invalid payment')).min(1).max(200).optional(),
    workerId: z.string().uuid('Invalid person').optional(),
    handedOverOn: z.string().refine(isValidYmd, { message: 'Pick a valid date.' }).optional(),
  })
  .refine((v) => Boolean(v.paymentIds) !== Boolean(v.workerId), { message: 'Pick payments or a person, not both.' });

export const undoHandOverSchema = z.object({ paymentId: z.string().uuid('Invalid payment') });

export const teamPaymentSchema = z.object({
  personId: z.string().uuid('Invalid person'),
  /** Pounds, up to 2 decimal places. The parsed value is PENCE. */
  amount: z.coerce
    .number({ message: 'Enter an amount.' })
    .min(0.01, 'Enter an amount.')
    .max(100000, 'That is too much for one payment.')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Up to 2 decimal places.')
    .transform(penceFromPounds),
  paidOn: z.string().refine(isValidYmd, { message: 'Pick a valid date.' }),
  note: z.string().trim().max(300).optional().or(z.literal('')),
  clientMutationId: z.string().min(8).max(64).optional(),
});

export const workDaySchema = z.object({
  personId: z.string().uuid('Invalid person'),
  date: z.string().refine(isValidYmd, { message: 'Pick a valid date.' }),
  /** Optional: a half day is the owner typing a smaller amount. Parsed value is PENCE. */
  ratePounds: dayRateSchema.optional(),
  note: z.string().trim().max(300).optional().or(z.literal('')),
});

export const editDaySchema = z.object({
  id: z.string().uuid('Invalid day'),
  ratePounds: dayRateSchema.optional(),
  note: z.string().trim().max(300).optional().or(z.literal('')),
});

export { nameSchema as teamNameSchema };
