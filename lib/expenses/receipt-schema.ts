import { z } from 'zod';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/books/categories';
import { roundMoney } from '@/lib/money/pence';
import { addDays, isValidYmd, type Ymd } from '@/lib/rounds/dates';

export const ReceiptReadSchema = z.object({
  is_receipt: z.boolean(),
  merchant: z.string(), // "" when unreadable
  date: z.string(), // YYYY-MM-DD or ""
  total: z.number().nullable(), // pounds, incl. VAT
  vat: z.number().nullable(),
  line_items: z.array(z.object({ description: z.string(), amount: z.number() })),
  category: z.enum(EXPENSE_CATEGORIES).nullable(),
  confidence: z.number().min(0).max(1),
});

export type ReceiptRead = z.infer<typeof ReceiptReadSchema>;

/** Confidence below this sends the photo to the escalation model (T5). */
export const ESCALATION_CONFIDENCE = 0.7;

/**
 * T5: re-read with the stronger model when the first read is unsure, the total
 * or date is missing, or line items are printed and do not add up to the total
 * (within 2p). A picture that is not a receipt is never escalated — a second
 * model will not make it one.
 */
export function needsEscalation(r: ReceiptRead): boolean {
  if (!r.is_receipt) return false;
  if (r.confidence < ESCALATION_CONFIDENCE) return true;
  if (r.total == null) return true;
  if (!isValidYmd(r.date)) return true;
  if (r.line_items.length > 0) {
    const sumPence = r.line_items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    if (Math.abs(sumPence - Math.round(r.total * 100)) > 2) return true;
  }
  return false;
}

export type DraftFields = {
  spent_on: Ymd | null;
  merchant: string | null;
  amount: number | null;
  vat_amount: number | null;
  category: ExpenseCategory | null;
  ai_confidence: number;
};

const MAX_MERCHANT_LENGTH = 120;
const MAX_AMOUNT = 100000;

/**
 * What the AI read, cleaned to what the expenses table accepts. Anything that
 * looks wrong is dropped rather than guessed: a future date, a date over two
 * years old, a total that is zero, negative or silly, VAT bigger than the total.
 */
export function toDraftFields(r: ReceiptRead, today: Ymd): DraftFields {
  const date = r.date.trim();
  const dateOk = isValidYmd(date) && date <= today && date >= addDays(today, -730);

  const total = r.total != null && Number.isFinite(r.total) ? roundMoney(r.total) : null;
  const amount = total != null && total > 0 && total <= MAX_AMOUNT ? total : null;

  const vat = r.vat != null && Number.isFinite(r.vat) ? roundMoney(r.vat) : null;
  const vatAmount = amount != null && vat != null && vat >= 0 && vat <= amount ? vat : null;

  const merchant = r.merchant.trim().slice(0, MAX_MERCHANT_LENGTH).trim();

  return {
    spent_on: dateOk ? date : null,
    merchant: merchant || null,
    amount,
    vat_amount: vatAmount,
    category: r.category ?? null,
    ai_confidence: Math.round(Math.min(1, Math.max(0, r.confidence)) * 100) / 100,
  };
}
