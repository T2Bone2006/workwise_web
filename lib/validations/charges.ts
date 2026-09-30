import { z } from 'zod';

export const addChargeSchema = z.object({
  customerId: z.string().uuid(),
  description: z.string().trim().min(1, 'Add a short description.').max(120),
  amount: z.number().positive('Enter an amount over £0.').max(100_000),
  chargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['starting_balance', 'other']).default('other'),
});

export const voidChargeSchema = z.object({
  chargeId: z.string().uuid(),
  reason: z.string().trim().max(300).optional(),
});

export type AddChargeValues = z.infer<typeof addChargeSchema>;
export type VoidChargeValues = z.infer<typeof voidChargeSchema>;
