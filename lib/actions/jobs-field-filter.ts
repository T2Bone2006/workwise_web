'use server';

import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { getFieldFilterValuesForTenant } from '@/lib/data/jobs';
import type { FieldFilterValueOption } from '@/lib/jobs/field-filter';

export async function fetchFieldFilterValuesAction(
  field: string,
  customerId?: string
): Promise<FieldFilterValueOption[]> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId || !field.trim()) return [];
  const { values } = await getFieldFilterValuesForTenant(tenantId, field.trim(), customerId);
  return values;
}
