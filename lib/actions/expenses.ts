'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminRounds as requireAdminRoundsFor } from '@/lib/auth/require-admin-rounds';
import {
  addExpenseCore,
  deleteExpenseCore,
  receiptSignedUrl,
  saveExpenseCore,
} from '@/lib/expenses/expenses-core';
import { MAX_RECEIPT_BYTES, scanReceiptCore } from '@/lib/expenses/read-receipt';
import {
  addExpenseSchema,
  clientMutationIdSchema,
  deleteExpenseSchema,
  saveExpenseSchema,
  type AddExpenseInput,
  type SaveExpenseInput,
} from '@/lib/validations/expenses';

const NOT_ROUNDS = 'Expenses are part of Rounds.';
const WRONG_TYPE = "That file type isn't supported. Use a photo (JPG or PNG) or a PDF.";
const HEIC = 'Save it as a JPG and try again.';
const TOO_BIG = 'That file is too big (8 MB max).';
const DAILY_LIMIT = "That's a lot of receipts for one day — try again tomorrow.";
const SAVE_FAILED = "Couldn't save that. Try again.";

type Failure = { success: false; error: string };

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

const requireAdminRounds = () => requireAdminRoundsFor(NOT_ROUNDS);

function revalidateExpenses() {
  revalidatePath('/expenses');
}

/** Type an expense in: counted straight away. */
export async function addExpense(
  input: AddExpenseInput,
): Promise<{ success: true; expenseId: string } | Failure> {
  const ctx = await requireAdminRounds();
  if (!ctx.success) return ctx;

  const parsed = addExpenseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await addExpenseCore(ctx.supabase, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    values: parsed.data,
  });
  if (!result.ok) return { success: false, error: result.error };

  revalidateExpenses();
  return { success: true, expenseId: result.expenseId };
}

function mimeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return '';
}

/** Scan a receipt photo or PDF into a To check draft. formData: file, clientMutationId. */
export async function scanReceipt(
  formData: FormData,
): Promise<
  | { success: true; expenseId: string; read: 'read' | 'unreadable' | 'not_a_receipt' }
  | Failure
> {
  const ctx = await requireAdminRounds();
  if (!ctx.success) return ctx;

  const file = formData.get('file');
  const clientMutationId = clientMutationIdSchema.safeParse(formData.get('clientMutationId'));
  if (!(file instanceof File) || !clientMutationId.success) {
    return { success: false, error: SAVE_FAILED };
  }

  const mime = mimeOf(file);
  if (mime === 'image/heic' || mime === 'image/heif') return { success: false, error: `${WRONG_TYPE} ${HEIC}` };
  if (file.size > MAX_RECEIPT_BYTES) return { success: false, error: TOO_BIG };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await scanReceiptCore(createAdminClient(), {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    clientMutationId: clientMutationId.data,
    file: { bytes, mime, name: file.name },
  });

  if (!result.ok) {
    const messages = {
      too_big: TOO_BIG,
      wrong_type: WRONG_TYPE,
      daily_limit: DAILY_LIMIT,
      storage_failed: SAVE_FAILED,
      save_failed: SAVE_FAILED,
    } as const;
    return { success: false, error: messages[result.error] };
  }

  revalidateExpenses();
  return { success: true, expenseId: result.expenseId, read: result.read };
}

/** Save on a To check draft confirms it; on a saved one it edits it. */
export async function saveExpense(input: SaveExpenseInput): Promise<{ success: true } | Failure> {
  const ctx = await requireAdminRounds();
  if (!ctx.success) return ctx;

  const parsed = saveExpenseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await saveExpenseCore(ctx.supabase, { tenantId: ctx.tenantId, values: parsed.data });
  if (!result.ok) return { success: false, error: result.error };

  revalidateExpenses();
  return { success: true };
}

export async function deleteExpense(input: { expenseId: string }): Promise<{ success: true } | Failure> {
  const ctx = await requireAdminRounds();
  if (!ctx.success) return ctx;

  const parsed = deleteExpenseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await deleteExpenseCore(ctx.supabase, createAdminClient(), {
    tenantId: ctx.tenantId,
    expenseId: parsed.data.expenseId,
  });
  if (!result.ok) return { success: false, error: result.error };

  revalidateExpenses();
  return { success: true };
}

/** A 5-minute link to the receipt photo. */
export async function getReceiptUrl(input: {
  expenseId: string;
}): Promise<{ success: true; url: string } | Failure> {
  const ctx = await requireAdminRounds();
  if (!ctx.success) return ctx;

  const parsed = deleteExpenseSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const url = await receiptSignedUrl(createAdminClient(), {
    tenantId: ctx.tenantId,
    expenseId: parsed.data.expenseId,
  });
  if (!url) return { success: false, error: "There's no photo for this expense." };
  return { success: true, url };
}
