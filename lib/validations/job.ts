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
  description: z.string().min(1, 'Description is required').max(1000),
  priority: z.enum(['low', 'normal', 'high', 'emergency']),
  job_length: z.enum(['half_day', 'full_day']).optional(),
  scheduled_date: z.string().optional(),
  scheduled_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time')
    .optional()
    .or(z.literal('')),
  end_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time')
    .optional()
    .or(z.literal('')),
  assigned_worker_id: z
    .union([
      z.string().uuid(),
      z.string().regex(/^business:[0-9a-fA-F-]{36}$/, 'Invalid connected business'),
      z.literal(''),
    ])
    .optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobCustomerSchema = z.object({
  jobId: z.string().uuid('Invalid job'),
  customer_id: z
    .union([z.string().uuid('Invalid customer'), z.literal(''), z.null()])
    .transform((val) => (val === '' ? null : val)),
});

export type UpdateJobCustomerInput = z.infer<typeof updateJobCustomerSchema>;
