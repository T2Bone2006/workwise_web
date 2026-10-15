import { z } from 'zod';
import { isValidYmd } from '@/lib/rounds/dates';

export const roundsSettingsSchema = z.object({
  horizon_weeks: z.coerce.number().int().min(1).max(12),
  reminder_days_before: z.coerce.number().int().min(0).max(14),
  working_days: z.array(z.number().int().min(1).max(7)).min(1),
  blackouts: z.array(z.string().refine(isValidYmd, { message: 'Invalid date' })),
  shift_off_non_working_days: z.boolean().default(false),
  start_postcode: z.string().trim().max(10).nullable(),
});

export type RoundsSettingsInput = z.input<typeof roundsSettingsSchema>;
export type RoundsSettingsValues = z.output<typeof roundsSettingsSchema>;
