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

/**
 * Editing a job's dispatch details after the fact (fixing a mistake) —
 * same field rules as creation, minus customer/worker/reference, which have
 * their own dedicated edit flows.
 */
export const updateJobDetailsSchema = createJobSchema
  .pick({
    address: true,
    postcode: true,
    description: true,
    priority: true,
    job_length: true,
    scheduled_date: true,
    scheduled_time: true,
    end_time: true,
  })
  .extend({ jobId: z.string().uuid('Invalid job') });

export type UpdateJobDetailsInput = z.infer<typeof updateJobDetailsSchema>;

const triState = z.enum(['yes', 'no', 'unset']);

/**
 * Editing the completion record a worker submitted (notes + trade-specific
 * report fields) — a correction, not a new submission, so no photos here.
 */
export const updateJobCompletionSchema = z.object({
  jobId: z.string().uuid('Invalid job'),
  completion_notes: z.string().max(2000).optional(),
  lock_changed: triState.optional(),
  walked_away: triState.optional(),
  walk_away_reason: z.string().max(200).optional(),
  walk_away_detail: z.string().max(1000).optional(),
});

export type UpdateJobCompletionInput = z.infer<typeof updateJobCompletionSchema>;
