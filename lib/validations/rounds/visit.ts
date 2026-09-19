import { z } from 'zod';
import { isValidYmd } from '@/lib/rounds/dates';
import { USER_SKIP_REASONS } from '@/lib/rounds/skip-reasons';
import { agreementSchema, hhmmTimeSchema } from './agreement';

export const skipVisitSchema = z.object({
  jobId: z.string().uuid('Invalid job'),
  reason: z.enum(USER_SKIP_REASONS),
  note: z.string().trim().max(300).optional().or(z.literal('')),
});

export type SkipVisitInput = z.input<typeof skipVisitSchema>;
export type SkipVisitValues = z.output<typeof skipVisitSchema>;

export const rescheduleVisitSchema = z.object({
  jobId: z.string().uuid('Invalid job'),
  scheduledDate: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  scheduledTime: hhmmTimeSchema,
});

export type RescheduleVisitInput = z.input<typeof rescheduleVisitSchema>;
export type RescheduleVisitValues = z.output<typeof rescheduleVisitSchema>;

export const moveRemainingSchema = z.object({
  fromDate: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  toDate: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  scheduledTime: hhmmTimeSchema,
});

export type MoveRemainingInput = z.input<typeof moveRemainingSchema>;
export type MoveRemainingValues = z.output<typeof moveRemainingSchema>;

export const completeVisitSchema = z.object({
  jobId: z.string().uuid('Invalid job'),
  finalAmount: z.coerce.number().min(0).nullable().optional(),
  notes: z.string().max(1000).optional().or(z.literal('')),
});

export type CompleteVisitInput = z.input<typeof completeVisitSchema>;
export type CompleteVisitValues = z.output<typeof completeVisitSchema>;

export const reorderDaySchema = z.object({
  date: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  jobIds: z.array(z.string().uuid('Invalid job')).min(1),
});

export type ReorderDayInput = z.input<typeof reorderDaySchema>;
export type ReorderDayValues = z.output<typeof reorderDaySchema>;

export const oneOffVisitSchema = agreementSchema
  .pick({
    customer_id: true,
    title: true,
    address: true,
    postcode: true,
    price: true,
    duration_minutes: true,
    access_notes: true,
  })
  .extend({
    scheduled_date: z.string().refine(isValidYmd, { message: 'Invalid date' }),
    scheduled_time: hhmmTimeSchema,
  });

export type OneOffVisitInput = z.input<typeof oneOffVisitSchema>;
export type OneOffVisitValues = z.output<typeof oneOffVisitSchema>;
