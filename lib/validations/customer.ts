import { z } from 'zod';

const ukPhoneRegex = /^(\+44|0)[0-9\s]{10,13}$/;

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
  notes: z.string().max(500).optional().or(z.literal('')),
});

export type CustomerFormInput = z.input<typeof customerSchema>;
export type CustomerFormValues = z.output<typeof customerSchema>;
