import { z } from 'zod';

export const workerSchema = z.object({
  full_name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100),
  phone: z
    .string()
    .regex(/^(\+44|0)[0-9\s]{10,13}$/, 'Invalid UK phone number')
    .transform((val) => val.replace(/\s/g, '')),
  email: z
    .union([z.string().email('Invalid email'), z.literal('')])
    .optional()
    .default(''),
  home_postcode: z
    .string()
    .regex(
      /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i,
      'Invalid UK postcode'
    )
    .transform((val) => {
      const clean = val.replace(/\s/g, '').toUpperCase();
      const match = clean.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)(\d[A-Z]{2})$/);
      return match ? `${match[1]} ${match[2]}` : val;
    }),
  worker_type: z.enum([
    'company_subcontractor',
    'platform_solo',
    'both',
  ]),
  status: z.enum([
    'available',
    'busy',
    'unavailable',
    'off_duty',
  ]),
  skills: z.array(z.string()).optional().default([]),
});

export type WorkerFormInput = z.input<typeof workerSchema>;
export type WorkerFormValues = z.output<typeof workerSchema>;
