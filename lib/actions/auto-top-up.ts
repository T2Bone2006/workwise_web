'use server';

import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { getTenantProducts } from '@/lib/data/tenant-products';
import {
  dismissAutoTopUpPrompt,
  disableAutoTopUp,
  enableAutoTopUp,
  readAutoTopUpSettings,
  resumeAutoTopUp,
} from '@/lib/messaging/auto-top-up';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

async function ownerWithRounds(): Promise<{ tenantId: string } | { error: string }> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return { error: 'Not signed in' };
  const products = await getTenantProducts();
  if (!products.hasRounds) return { error: 'Auto top-up is part of Rounds.' };
  return { tenantId };
}

export async function saveAutoTopUp(input: {
  packKey: string;
  triggerLeft: number;
  monthlyCapPounds: number;
}): Promise<{ ok: true } | { needsCard: true; url: string } | { error: string }> {
  const who = await ownerWithRounds();
  if ('error' in who) return who;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return enableAutoTopUp(createAdminClient(), who.tenantId, user?.email ?? null, input);
}

export async function turnOffAutoTopUp(): Promise<{ ok: true } | { error: string }> {
  const who = await ownerWithRounds();
  if ('error' in who) return who;
  return disableAutoTopUp(createAdminClient(), who.tenantId);
}

export async function resumeAutoTopUpAction(): Promise<{ ok: true } | { error: string }> {
  const who = await ownerWithRounds();
  if ('error' in who) return who;
  return resumeAutoTopUp(createAdminClient(), who.tenantId);
}

export async function dismissAutoTopUpPromptAction(): Promise<void> {
  const who = await ownerWithRounds();
  if ('error' in who) return;
  await dismissAutoTopUpPrompt(createAdminClient(), who.tenantId);
}

/** The card that would be charged (brand and last 4), read live from Stripe. Null when there is none. */
export async function readAutoTopUpCard(): Promise<{ brand: string; last4: string } | null> {
  const who = await ownerWithRounds();
  if ('error' in who) return null;
  try {
    return (await readAutoTopUpSettings(createAdminClient(), who.tenantId)).card;
  } catch {
    return null;
  }
}
