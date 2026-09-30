'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import type { ActionResult } from '@/lib/actions/payments';
import { getCustomerBalance } from '@/lib/data/payments/owed';
import { addChargeCore, voidChargeCore } from '@/lib/payments/charges-core';
import { addChargeSchema, voidChargeSchema } from '@/lib/validations/charges';

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

function revalidateMoney(customerId?: string | null) {
  revalidatePath('/payments');
  revalidatePath('/dashboard');
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

async function requireRounds(): Promise<
  | {
      success: true;
      tenantId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string | null;
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { success: true, tenantId, supabase, userId: user?.id ?? null };
}

/** D12: add an "other amount owed" (dashboard only). owedAmount = the balance after it. */
export async function addCustomerCharge(
  input: z.infer<typeof addChargeSchema>,
): Promise<ActionResult & { owedAmount?: number }> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = addChargeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await addChargeCore(ctx.supabase, {
    tenantId: ctx.tenantId,
    customerId: parsed.data.customerId,
    description: parsed.data.description,
    amount: parsed.data.amount,
    chargeDate: parsed.data.chargeDate,
    kind: parsed.data.kind,
    userId: ctx.userId,
  });
  if (!result.success) return { success: false, error: result.error };

  const balance = await getCustomerBalance(
    ctx.supabase,
    ctx.tenantId,
    parsed.data.customerId,
  );

  revalidateMoney(parsed.data.customerId);
  return { success: true, owedAmount: balance.owedAmount };
}

/** D12: remove an "other amount owed" (void, never delete). */
export async function voidCustomerCharge(
  input: z.infer<typeof voidChargeSchema>,
): Promise<ActionResult> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = voidChargeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await voidChargeCore(ctx.supabase, {
    tenantId: ctx.tenantId,
    chargeId: parsed.data.chargeId,
    userId: ctx.userId,
  });
  if (!result.success) return { success: false, error: result.error };

  const { data: charge } = await ctx.supabase
    .from('customer_charges')
    .select('customer_id')
    .eq('id', parsed.data.chargeId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  revalidateMoney(
    (charge as { customer_id?: string | null } | null)?.customer_id ?? null,
  );
  return { success: true };
}
