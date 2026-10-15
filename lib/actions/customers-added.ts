'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { createAdminClient } from '@/lib/supabase/admin';
import { markCheckedCore } from '@/lib/team/added-by-core';

/** The owner's "Looks fine" and "Mark all checked" for customers a member of staff added. Owner only. */

type Result = { ok: true; changed: number } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

function refresh(customerId?: string) {
  revalidatePath('/customers');
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function markCustomerChecked(customerId: string): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  if (!UUID.test(customerId)) return { ok: false, error: 'Not found.' };
  const result = await markCheckedCore(createAdminClient(), { tenantId: owner.tenantId, customerId });
  if (result.ok) refresh(customerId);
  return result;
}

export async function markAllChecked(): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  const result = await markCheckedCore(createAdminClient(), { tenantId: owner.tenantId });
  if (result.ok) refresh();
  return result;
}
