import { z } from 'zod';
import {
  normaliseAccountNumber,
  normaliseSortCode,
} from '@/lib/payments/bank-format';

export const paymentMethodSchema = z.enum([
  'cash',
  'cheque',
  'bank_transfer',
  'card',
  'other',
]);

export const moneyAmountSchema = z.coerce
  .number()
  .positive('Enter an amount')
  .max(100000)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
    'Up to 2 decimal places',
  );

export const recordPaymentSchema = z.object({
  customerId: z.string().uuid(),
  amount: moneyAmountSchema,
  method: paymentMethodSchema,
  receivedAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(300).nullable().optional().or(z.literal('')),
  appliesToJobId: z.string().uuid().nullable().optional(),
  invoiceId: z.string().uuid().nullable().optional(),
  clientMutationId: z.string().min(8).max(64).optional(),
});

export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
export type RecordPaymentValues = z.output<typeof recordPaymentSchema>;

export const voidPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().trim().max(300).optional().or(z.literal('')),
});

export type VoidPaymentInput = z.input<typeof voidPaymentSchema>;
export type VoidPaymentValues = z.output<typeof voidPaymentSchema>;

export const waiveVisitSchema = z.object({
  jobId: z.string().uuid(),
  waived: z.boolean(),
});

export type WaiveVisitInput = z.input<typeof waiveVisitSchema>;
export type WaiveVisitValues = z.output<typeof waiveVisitSchema>;

export const paymentSettingsSchema = z
  .object({
    bankAccountName: z.string().trim().max(70).optional().or(z.literal('')),
    bankSortCode: z.string().trim().optional().or(z.literal('')),
    bankAccountNumber: z.string().trim().optional().or(z.literal('')),
    vatRegistered: z.boolean(),
    vatNumber: z.string().trim().max(20).optional().or(z.literal('')),
    invoiceDueDays: z.coerce.number().int().min(0).max(90),
    invoicePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,10}$/),
    invoiceFooter: z.string().trim().max(500).optional().or(z.literal('')),
  })
  .superRefine((val, ctx) => {
    const name = (val.bankAccountName ?? '').trim();
    const sortRaw = (val.bankSortCode ?? '').trim();
    const acctRaw = (val.bankAccountNumber ?? '').trim();
    const anyBank = Boolean(name || sortRaw || acctRaw);
    const allBank = Boolean(name && sortRaw && acctRaw);

    if (anyBank && !allBank) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter account name, sort code and account number together.',
        path: ['bankAccountName'],
      });
    }

    if (sortRaw) {
      if (!normaliseSortCode(sortRaw)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a 6-digit sort code.',
          path: ['bankSortCode'],
        });
      }
    }

    if (acctRaw) {
      if (!normaliseAccountNumber(acctRaw)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a 7 or 8 digit account number.',
          path: ['bankAccountNumber'],
        });
      }
    }

    if (val.vatRegistered) {
      const vat = (val.vatNumber ?? '').trim();
      if (vat.length < 5 || vat.length > 20) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a VAT number (5–20 characters).',
          path: ['vatNumber'],
        });
      }
    }
  });

export type PaymentSettingsInput = z.input<typeof paymentSettingsSchema>;
export type PaymentSettingsValues = z.output<typeof paymentSettingsSchema>;

export const sendInvoiceSchema = z
  .object({
    customerId: z.string().uuid(),
    scope: z.enum(['visit', 'balance']),
    jobId: z.string().uuid().optional(),
  })
  .refine((v) => v.scope === 'balance' || !!v.jobId, 'Pick a visit');

export type SendInvoiceInput = z.input<typeof sendInvoiceSchema>;
export type SendInvoiceValues = z.output<typeof sendInvoiceSchema>;
