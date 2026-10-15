import { z } from 'zod';
import { isValidYmd } from '@/lib/rounds/dates';
import { USER_SKIP_REASONS } from '@/lib/rounds/skip-reasons';
import { moneyAmountSchema } from '@/lib/validations/payments';
import { agreementSchema, hhmmTimeSchema } from './agreement';

export const skipVisitSchema = z.object({
  jobId: z.string().uuid('Invalid job'),
  reason: z.enum(USER_SKIP_REASONS),
  /** Phone outbox may send `null` when there is no note. */
  note: z.string().trim().max(300).nullable().optional().or(z.literal('')),
  notifyCustomer: z.boolean().optional(),
});

export type SkipVisitInput = z.input<typeof skipVisitSchema>;
export type SkipVisitValues = z.output<typeof skipVisitSchema>;

export const rescheduleVisitSchema = z.object({
  jobId: z.string().uuid('Invalid job'),
  scheduledDate: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  scheduledTime: hhmmTimeSchema,
  notifyCustomer: z.boolean().optional(),
});

export type RescheduleVisitInput = z.input<typeof rescheduleVisitSchema>;
export type RescheduleVisitValues = z.output<typeof rescheduleVisitSchema>;

export const moveRemainingSchema = z.object({
  fromDate: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  toDate: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  scheduledTime: hhmmTimeSchema,
  notifyCustomers: z.boolean().optional(),
  /** Only this person's leftovers (the calendar's lanes). Left out = everyone's, as before. */
  workerId: z.string().uuid('Invalid person').optional(),
});

export type MoveRemainingInput = z.input<typeof moveRemainingSchema>;
export type MoveRemainingValues = z.output<typeof moveRemainingSchema>;

export const completeVisitSchema = z.object({
  jobId: z.string().uuid('Invalid job'),
  finalAmount: z.coerce.number().min(0).nullable().optional(),
  notes: z.string().max(1000).optional().or(z.literal('')),
  payment: z
    .object({
      method: z.enum(['cash', 'cheque']),
      amount: moneyAmountSchema,
    })
    .nullable()
    .optional(),
  sendInvoice: z.boolean().nullable().optional(),
  clientMutationId: z.string().min(8).max(64).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
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

export const skipRemainingSchema = z.object({
  date: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  notifyCustomers: z.boolean().optional(),
  /** Only this person's leftovers. Left out = everyone's, as before. */
  workerId: z.string().uuid('Invalid person').optional(),
});

export type SkipRemainingInput = z.input<typeof skipRemainingSchema>;
export type SkipRemainingValues = z.output<typeof skipRemainingSchema>;

export const undoVisitChangeSchema = z.object({
  changeId: z.string().uuid('Invalid change'),
  // default true for undo when the change was notified
  notifyCustomers: z.boolean().optional(),
});

export type UndoVisitChangeInput = z.input<typeof undoVisitChangeSchema>;
export type UndoVisitChangeValues = z.output<typeof undoVisitChangeSchema>;

const boardYmd = z.string().refine(isValidYmd, { message: 'Invalid date' });

export const moveStopSchema = z.object({
  jobIds: z.array(z.string().uuid('Invalid job')).min(1).max(20),
  toDate: boardYmd,
  orderedJobIds: z.array(z.string().uuid('Invalid job')).max(300).optional(),
});

/** A whole round's houses for one day, moved together. One logged change, so one Undo. */
export const moveRoundSchema = z.object({
  jobIds: z.array(z.string().uuid('Invalid job')).min(1).max(300),
  toDate: boardYmd,
});

export type MoveRoundInput = z.input<typeof moveRoundSchema>;

export type MoveStopInput = z.input<typeof moveStopSchema>;
export type MoveStopValues = z.output<typeof moveStopSchema>;

export const swapDaysSchema = z.object({
  dayA: boardYmd,
  dayB: boardYmd,
  clientKey: z.string().uuid('Invalid request'),
  notifyCustomers: z.boolean().optional(),
});

export type SwapDaysInput = z.input<typeof swapDaysSchema>;
export type SwapDaysValues = z.output<typeof swapDaysSchema>;

export const tellChangeSchema = z.object({ changeId: z.string().uuid('Invalid change') });

export type TellChangeInput = z.input<typeof tellChangeSchema>;
export type TellChangeValues = z.output<typeof tellChangeSchema>;

export const reassignVisitsSchema = z.object({
  jobIds: z.array(z.string().uuid('Invalid job')).min(1).max(100),
  toWorkerId: z.string().uuid('Invalid person'),
});
export type ReassignVisitsInput = z.input<typeof reassignVisitsSchema>;

export const giveRoundSchema = z.object({
  date: z.string().refine(isValidYmd, { message: 'Invalid date' }),
  fromWorkerId: z.string().uuid('Invalid person'),
  toWorkerId: z.string().uuid('Invalid person'),
  roundId: z.string().uuid('Invalid round').nullable().optional(),
});
export type GiveRoundInput = z.input<typeof giveRoundSchema>;

export const setUsualLeadSchema = z.object({
  roundId: z.string().uuid('Invalid round'),
  workerId: z.string().uuid('Invalid person').nullable(),
});
export type SetUsualLeadInput = z.input<typeof setUsualLeadSchema>;

export const pushBackSchema = z
  .object({
    workerId: z.string().uuid('Invalid person'),
    offFrom: z.string().refine(isValidYmd, { message: 'Invalid date' }),
    offTo: z.string().refine(isValidYmd, { message: 'Invalid date' }),
    notifyCustomers: z.boolean().optional(),
  })
  .refine((v) => v.offTo >= v.offFrom, { message: 'The last day can’t be before the first day.', path: ['offTo'] });
export type PushBackInputValues = z.input<typeof pushBackSchema>;
