import { z } from 'zod';

const ukPhoneRegex = /^(\+44|0)[0-9\s]{10,13}$/;

/** Rounds add-customer "Owes from before" (Phase 4 D12). Blank = nothing owed. */
export const owesFromBeforeSchema = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce
      .number({ error: 'Enter the amount owed from before, like 15.' })
      .min(0, 'Enter the amount owed from before, like 15.')
      .max(100_000, 'Enter an amount up to £100,000.')
      .refine(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
        'Up to 2 decimal places',
      )
      .optional(),
  )
  .optional();

export const customerSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(200),
  type: z.enum(['bulk_client', 'individual']),
  email: z
    .union([z.string().email('Invalid email'), z.literal('')])
    .optional()
    .default(''),
  phone: z
    .union([
      z.string().regex(ukPhoneRegex, 'Invalid UK phone number'),
      z.literal(''),
    ])
    .optional()
    .default('')
    .transform((val) => (val ? val.replace(/\s/g, '') : '')),
  address: z.string().max(500).optional().or(z.literal('')),
  postcode: z.string().max(12).optional().or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
  payment_terms: z.enum(['on_the_day', 'invoice']).optional(),
  access_notes: z.string().max(500).optional().or(z.literal('')),
  preferred_channel: z.enum(['default', 'whatsapp', 'sms', 'email', 'none']).optional(),
  owesFromBefore: owesFromBeforeSchema,
});

export type CustomerFormInput = z.input<typeof customerSchema>;
export type CustomerFormValues = z.output<typeof customerSchema>;
