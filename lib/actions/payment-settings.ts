'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { setCompanyLogoCore } from '@/lib/business/logo';
import { savePaymentSettingsCore } from '@/lib/payments/money-core';
import {
  paymentSettingsSchema,
  type PaymentSettingsInput,
} from '@/lib/validations/payments';

export type ActionResult = { success: true } | { success: false; error: string };

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

async function requireRounds(): Promise<
  | {
      success: true;
      tenantId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
  | { success: false; error: string }
> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds) {
    return { success: false, error: 'Payments are part of Rounds.' };
  }

  const supabase = await createClient();
  return { success: true, tenantId, supabase };
}

export async function savePaymentSettings(
  input: PaymentSettingsInput,
): Promise<ActionResult> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = paymentSettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const saved = await savePaymentSettingsCore(ctx.supabase, ctx.tenantId, parsed.data);
  if (!saved.success) return saved;

  revalidatePath('/settings');
  revalidatePath('/payments');
  return { success: true };
}

/** path = a storage object path the browser just uploaded (`<tenantId>/logo-<ts>.png`), or null to remove. */
export async function setCompanyLogo(
  path: string | null,
): Promise<ActionResult & { logoUrl?: string | null }> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const result = await setCompanyLogoCore(ctx.supabase, ctx.tenantId, path);
  if (!result.success) return result;

  revalidatePath('/settings');
  revalidatePath('/payments');
  return { success: true, logoUrl: result.logoUrl };
}
