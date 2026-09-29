import { z } from 'zod';
import { agreementSchema } from '@/lib/validations/rounds/agreement';

export const customerFieldSchema = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('name'),
    value: z.string().trim().min(2, 'Name is too short').max(120),
  }),
  z.object({
    field: z.literal('phone'),
    value: z.string().trim().max(30),
  }),
  z.object({
    field: z.literal('email'),
    value: z.string().trim().email('Enter a valid email').or(z.literal('')),
  }),
  z.object({
    field: z.literal('contact_choice'),
    value: z.enum(['default', 'sms', 'email', 'none']),
  }),
  z.object({
    field: z.literal('visit_reminders'),
    value: z.boolean(),
  }),
  z.object({
    field: z.literal('payment_chasers'),
    value: z.boolean(),
  }),
  z.object({
    field: z.literal('payment_thanks'),
    value: z.boolean(),
  }),
  z.object({
    field: z.literal('payment_terms'),
    value: z.enum(['on_the_day', 'invoice']),
  }),
  z.object({
    field: z.literal('house'),
    value: z.object({
      address: agreementSchema.shape.address,
      postcode: agreementSchema.shape.postcode,
    }),
  }),
  z.object({
    field: z.literal('access_notes'),
    value: z.string().trim().max(500),
  }),
  z.object({
    field: z.literal('notes'),
    value: z.string().trim().max(500),
  }),
]);

export type CustomerFieldInput = z.input<typeof customerFieldSchema>;
