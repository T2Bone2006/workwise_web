import { z } from 'zod';

const money = z.number().positive().max(50000);

export const JobTypeSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9-]{2,40}$/),
    name: z.string().min(2).max(60),
    how_priced: z.enum(['from_description', 'needs_visit']),
    guide_min: money.nullable(),
    guide_max: money.nullable(),
    what_changes_price: z.string().max(400),
    auto_accept: z.boolean(),
  })
  .superRefine((job, ctx) => {
    if (job.guide_min != null && job.guide_max != null && job.guide_min > job.guide_max) {
      ctx.addIssue({ code: 'custom', message: 'guide_min must be <= guide_max', path: ['guide_min'] });
    }
    if (job.how_priced === 'from_description' && (job.guide_min == null || job.guide_max == null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'from_description needs a guide range',
        path: ['guide_min'],
      });
    }
    if (job.auto_accept && job.how_priced !== 'from_description') {
      ctx.addIssue({
        code: 'custom',
        message: 'auto_accept only when priced from a description',
        path: ['auto_accept'],
      });
    }
  });

export const PriceProfileSchema = z
  .object({
    areas: z.object({
      summary: z.string().max(300),
      postcodes: z.array(z.string().max(8)).max(60),
      max_miles: z.number().positive().max(200).nullable(),
    }),
    callout_fee: money.nullable(),
    hourly_rate: money.nullable(),
    day_rate: money.nullable(),
    minimum_charge: money.nullable(),
    materials: z.string().max(300),
    job_types: z.array(JobTypeSchema).min(1).max(30),
    rules: z.array(z.string().max(200)).max(20),
    example_jobs: z
      .array(z.object({ description: z.string().max(300), price: money, reasoning: z.string().max(400) }))
      .max(10),
    tone: z.string().max(200),
  })
  .superRefine((profile, ctx) => {
    const keys = profile.job_types.map((job) => job.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', message: 'job type keys must be unique', path: ['job_types'] });
    }
  });

export type PriceProfile = z.infer<typeof PriceProfileSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;

/** safeParse; null on failure (the bot then runs in enquiry mode). */
export function parseProfile(raw: unknown): PriceProfile | null {
  const parsed = PriceProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
