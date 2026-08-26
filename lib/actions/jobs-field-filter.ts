'use server';

import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getFieldFilterValuesForTenant } from '@/lib/data/jobs';
import type { FieldFilterValueOption } from '@/lib/jobs/field-filter';

export async function fetchFieldFilterValuesAction(
  field: string
): Promise<FieldFilterValueOption[]> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId || !field.trim()) return [];
  const { values } = await getFieldFilterValuesForTenant(tenantId, field.trim());
  return values;
}
