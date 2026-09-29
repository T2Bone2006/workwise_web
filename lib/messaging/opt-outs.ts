import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

function fail(scope: string, message: string): never {
  console.error(`[${scope}]`, message);
  throw new Error(message);
}

/** Global: messaging_opt_outs upsert + customers.messaging_opt_out_at = now on EVERY customer with this phone. */
export async function recordOptOut(
  admin: SupabaseClient,
  phone: string,
  keyword: string,
): Promise<void> {
  const stamp = new Date().toISOString();
  const { error: optError } = await admin.from('messaging_opt_outs').upsert(
    {
      phone_e164: phone,
      opted_out_at: stamp,
      source: 'keyword',
      last_keyword: keyword,
    },
    { onConflict: 'phone_e164' },
  );
  if (optError) fail('recordOptOut', optError.message);

  const { error: customerError } = await admin
    .from('customers')
    .update({ messaging_opt_out_at: stamp })
    .eq('phone_e164', phone);
  if (customerError) fail('recordOptOut', customerError.message);
}

/** Global: delete from messaging_opt_outs + customers.messaging_opt_out_at = null for this phone. */
export async function recordOptIn(
  admin: SupabaseClient,
  phone: string,
): Promise<void> {
  const { error: optError } = await admin
    .from('messaging_opt_outs')
    .delete()
    .eq('phone_e164', phone);
  if (optError) fail('recordOptIn', optError.message);

  const { error: customerError } = await admin
    .from('customers')
    .update({ messaging_opt_out_at: null })
    .eq('phone_e164', phone);
  if (customerError) fail('recordOptIn', customerError.message);
}
