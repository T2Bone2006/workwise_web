'use server';

import { createTextPackCheckout } from '@/lib/messaging/text-packs';
import type { TextPackKey } from '@/lib/messaging/credits';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function startTextPackCheckout(
  packKey: string,
): Promise<{ url: string } | { error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds && !products.hasLite) return { error: 'Text packs are part of Rounds.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    return await createTextPackCheckout(createAdminClient(), {
      tenantId,
      userEmail: user?.email ?? null,
      packKey: packKey as TextPackKey,
      returnTo: products.hasRounds ? 'dashboard' : 'lite',
    });
  } catch (err) {
    console.error('[startTextPackCheckout]', err);
    return { error: 'Could not start checkout' };
  }
}
