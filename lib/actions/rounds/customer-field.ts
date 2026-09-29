'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { updateCustomerFieldCore } from '@/lib/rounds/customer-field';
import {
  customerFieldSchema,
  type CustomerFieldInput,
} from '@/lib/validations/rounds/customer-field';

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

export async function updateCustomerField(
  customerId: string,
  change: CustomerFieldInput,
): Promise<{ success: true; value: unknown } | { success: false; error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const products = await getTenantProducts();
  if (!products.hasRounds) return { success: false, error: 'Not available' };

  if (!z.string().uuid().safeParse(customerId).success) {
    return { success: false, error: 'Customer not found' };
  }

  const parsed = customerFieldSchema.safeParse(change);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await updateCustomerFieldCore(supabase, {
    tenantId,
    customerId,
    change: parsed.data,
  });
  if (!result.success) return result;

  revalidatePath(`/customers/${customerId}`);
  revalidatePath('/customers');
  if (parsed.data.field === 'house') {
    revalidatePath('/calendar');
    revalidatePath('/dashboard');
  }
  return result;
}
