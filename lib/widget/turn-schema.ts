import { z } from 'zod';

export const WidgetTurnSchema = z.object({
  reply: z.string().min(1).max(700),
  quote: z
    .object({
      kind: z.enum(['firm', 'guide', 'visit']),
      job_type_key: z.string().nullable(),
      amount: z.number().nullable(),
      min: z.number().nullable(),
      max: z.number().nullable(),
      summary: z.string().max(200),
    })
    .nullable(),
  ask_for_details: z.boolean(),
  out_of_area: z.boolean(),
});

export type WidgetTurn = z.infer<typeof WidgetTurnSchema>;

export type GuardedQuote =
  | { kind: 'firm'; jobTypeKey: string; amount: number; summary: string }
  | { kind: 'guide'; jobTypeKey: string; min: number; max: number; summary: string }
  | { kind: 'visit'; jobTypeKey: string | null; summary: string };
