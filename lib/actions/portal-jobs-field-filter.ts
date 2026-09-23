'use server';

import { createClient } from '@/lib/supabase/server';
import { getFieldFilterValuesForCustomer } from '@/lib/data/jobs';
import type { FieldFilterValueOption } from '@/lib/jobs/field-filter';

/**
 * Portal field-filter value loader. Verifies the signed-in user is linked to
 * the customer before returning distinct values (RLS is a second line).
 */
export async function fetchPortalFieldFilterValuesAction(
  field: string,
  customerId: string
): Promise<FieldFilterValueOption[]> {
  const trimmedField = field.trim();
  const trimmedCustomerId = customerId.trim();
  if (!trimmedField || !trimmedCustomerId) return [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: link } = await supabase
    .from('customer_portal_users')
    .select('customer_id')
    .eq('user_id', user.id)
    .eq('customer_id', trimmedCustomerId)
    .maybeSingle();

  if (!link) return [];

  const { values } = await getFieldFilterValuesForCustomer(
    trimmedCustomerId,
    trimmedField
  );
  return values;
}
