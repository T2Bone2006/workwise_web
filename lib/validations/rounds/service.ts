import { z } from 'zod';

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  default_price: z.coerce.number().min(0),
  default_duration_minutes: z.coerce.number().int().min(5).max(600),
  default_frequency_days: z.coerce.number().int().min(1).max(365).nullable().optional(),
  is_active: z.boolean().default(true),
});

export type ServiceInput = z.input<typeof serviceSchema>;
export type ServiceValues = z.output<typeof serviceSchema>;
