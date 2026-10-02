import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '@/lib/books/categories';
import { isValidYmd, todayInLondon } from '@/lib/rounds/dates';

export const clientMutationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const MIN_SPENT_ON = '2000-01-01';

const ymdSchema = z
  .string()
  .refine((v) => isValidYmd(v), { message: 'Enter the date' })
  .refine((v) => v >= MIN_SPENT_ON, { message: "That date's too long ago" })
  .refine((v) => v <= todayInLondon(), { message: "The date can't be in the future" });

const fieldsShape = {
  spentOn: ymdSchema,
  merchant: z.string().trim().max(120).optional().default(''),
  category: z.enum(EXPENSE_CATEGORIES, { message: 'Pick a category' }),
  amount: z.number('Enter the amount').positive('Enter the amount').max(100000),
  vatAmount: z.number().min(0).nullable().optional(),
  note: z.string().trim().max(500).optional().default(''),
};

type VatCheck = { amount: number; vatAmount?: number | null };
const vatNotMoreThanTotal = {
  check: (v: VatCheck) => v.vatAmount == null || v.vatAmount <= v.amount,
  params: { message: "VAT can't be more than the total", path: ['vatAmount'] },
};

export const expenseFieldsSchema = z
  .object(fieldsShape)
  .refine(vatNotMoreThanTotal.check, vatNotMoreThanTotal.params);

export const addExpenseSchema = z
  .object({ ...fieldsShape, clientMutationId: clientMutationIdSchema })
  .refine(vatNotMoreThanTotal.check, vatNotMoreThanTotal.params);

export const saveExpenseSchema = z
  .object({ ...fieldsShape, expenseId: z.string().uuid() })
  .refine(vatNotMoreThanTotal.check, vatNotMoreThanTotal.params);

export const deleteExpenseSchema = z.object({ expenseId: z.string().uuid() });

export type ExpenseFields = z.infer<typeof expenseFieldsSchema>;
export type AddExpense = z.infer<typeof addExpenseSchema>;
export type SaveExpense = z.infer<typeof saveExpenseSchema>;
export type AddExpenseInput = z.input<typeof addExpenseSchema>;
export type SaveExpenseInput = z.input<typeof saveExpenseSchema>;
