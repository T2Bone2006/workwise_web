import { z } from 'zod';

export const createJobSchema = z.object({
  reference_number: z.string().max(50).optional(),
  customer_id: z.string().uuid('Invalid customer'),
  address: z.string().min(5, 'Address must be at least 5 characters').max(200),
  postcode: z
    .string()
    .transform((val) => val.replace(/\s/g, '').toUpperCase())
    .refine((val) => /^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2}$/.test(val), {
      message: 'Invalid UK postcode',
    })
    .transform((val) => {
      const match = val.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)(\d[A-Z]{2})$/);
      return match ? `${match[1]} ${match[2]}` : val;
    }),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(1000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  scheduled_date: z.string().optional(),
  assigned_worker_id: z
    .union([z.string().uuid(), z.literal('')])
    .optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
