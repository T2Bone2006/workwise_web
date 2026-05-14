import { z } from 'zod';
import { workerSchema } from '@/lib/validations/worker';

/** Same fields as onboarding + required email — used only for invite-worker flow */
export const inviteWorkerPayloadSchema = workerSchema.omit({ email: true }).extend({
  email: z.string().min(1, 'Email is required').email('Invalid email'),
  skills: z.array(z.string()).max(10, 'At most 10 skills').optional().default([]),
});

export type InviteWorkerPayload = z.output<typeof inviteWorkerPayloadSchema>;
export type InviteWorkerFormInput = z.input<typeof inviteWorkerPayloadSchema>;
