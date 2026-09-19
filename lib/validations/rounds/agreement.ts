import { z } from 'zod';
import { isValidYmd } from '@/lib/rounds/dates';

/** Same transform + refine as `createJobSchema.postcode` in `lib/validations/job.ts`. */
export const ukPostcodeSchema = z
  .string()
  .transform((val) => val.replace(/\s/g, '').toUpperCase())
  .refine((val) => /^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2}$/.test(val), {
    message: 'Invalid UK postcode',
  })
  .transform((val) => {
    const match = val.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)(\d[A-Z]{2})$/);
    return match ? `${match[1]} ${match[2]}` : val;
  });

export const hhmmTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time')
  .nullable()
  .optional()
  .or(z.literal(''));

export const agreementSchema = z.object({
  customer_id: z.string().uuid('Invalid customer'),
  service_catalog_id: z.string().uuid('Invalid service').nullable().optional(),
  title: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(200),
  postcode: ukPostcodeSchema,
  price: z.coerce.number().min(0).max(100000),
  duration_minutes: z.coerce.number().int().min(5).max(600).default(30),
  frequency_days: z.coerce.number().int().min(1).max(365),
  schedule_mode: z.enum(['after_completion', 'fixed']).default('fixed'),
  anchor_date: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  preferred_weekday: z.coerce.number().int().min(1).max(7).nullable().optional(),
  preferred_time: hhmmTimeSchema,
  default_payment_method: z
    .enum(['cash', 'bank_transfer', 'card', 'cheque', 'other'])
    .nullable()
    .optional(),
  reminder_enabled: z.boolean().default(true),
  access_notes: z.string().trim().max(500).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

export type AgreementInput = z.input<typeof agreementSchema>;
export type AgreementValues = z.output<typeof agreementSchema>;

export const doorstepCustomerSchema = agreementSchema
  .pick({
    title: true,
    address: true,
    postcode: true,
    price: true,
    duration_minutes: true,
    frequency_days: true,
    schedule_mode: true,
    preferred_weekday: true,
    preferred_time: true,
    access_notes: true,
    service_catalog_id: true,
    anchor_date: true,
  })
  .extend({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(7).max(30),
    email: z.string().email('Invalid email').optional().or(z.literal('')),
  });

export type DoorstepCustomerInput = z.input<typeof doorstepCustomerSchema>;
export type DoorstepCustomerValues = z.output<typeof doorstepCustomerSchema>;
