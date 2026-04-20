import { z } from 'zod';

export const workerInviteSchema = z.object({
  full_name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100),
  email: z.string().email('Invalid email'),
  phone: z
    .string()
    .regex(/^(\+44|0)[0-9\s]{10,13}$/, 'Invalid UK phone number')
    .transform((val) => val.replace(/\s/g, '')),
});

export type WorkerInviteInput = z.infer<typeof workerInviteSchema>;
