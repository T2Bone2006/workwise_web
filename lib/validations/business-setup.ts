import { z } from 'zod';

/** What a self-employed worker tells us when they accept a set-up invite. */
export const businessSetupSchema = z.object({
  businessName: z.string().trim().min(2, 'Please enter your business name.').max(80, 'That name is too long.'),
  trade: z.string().trim().max(60).optional().default(''),
  postcode: z.string().trim().max(10).optional().default(''),
});

export type BusinessSetup = z.output<typeof businessSetupSchema>;
