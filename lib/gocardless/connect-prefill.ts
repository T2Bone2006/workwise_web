import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSignupDetails } from '@/lib/stripe/connect';

export type GoCardlessPrefill = {
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  businessName: string;
};

export function splitName(fullName: string | null): { givenName: string | null; familyName: string | null } {
  const name = fullName?.trim() ?? '';
  if (name === '') return { givenName: null, familyName: null };
  const space = name.indexOf(' ');
  if (space === -1) return { givenName: name, familyName: null };
  return {
    givenName: name.slice(0, space).trim() || null,
    familyName: name.slice(space + 1).trim() || null,
  };
}

/** What GoCardless's sign-up form is pre-filled with (dashboard and phone connect share it). */
export async function goCardlessPrefillFor(
  supabase: SupabaseClient,
  p: { userId: string; tenantId: string; fallbackEmail?: string | null },
): Promise<GoCardlessPrefill> {
  const { data: userRow } = await supabase
    .from('users')
    .select('email, full_name')
    .eq('id', p.userId)
    .maybeSingle();
  const loginEmail = typeof userRow?.email === 'string' ? userRow.email : (p.fallbackEmail ?? null);
  const identity = await connectSignupDetails(p.tenantId, loginEmail);
  const { givenName, familyName } = splitName(
    typeof userRow?.full_name === 'string' ? userRow.full_name : null,
  );
  return { email: loginEmail, givenName, familyName, businessName: identity.businessName };
}
