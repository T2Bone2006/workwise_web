'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { cleanRoundName, isRoundColour, membershipChanges } from '@/lib/rounds/rounds';

export type SaveRoundResult = { success: true; id: string } | { success: false; error: string };
export type DeleteRoundResult = { success: true } | { success: false; error: string };

const inputSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string(),
  colour: z.string(),
  placeIds: z.array(z.string().uuid()).max(5000),
});

export type SaveRoundInput = z.input<typeof inputSchema>;

const CHUNK = 200;
const NOT_OWNER = 'Only the account owner can change rounds.';

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

function refresh() {
  revalidatePath('/map');
  revalidatePath('/customers');
}

/**
 * Creates a round, or renames and recolours one and sets exactly which places
 * are in it. Safe to run again: it only writes the difference.
 */
export async function saveRound(input: SaveRoundInput): Promise<SaveRoundResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Something was wrong with that round. Try again.' };
  const { id: existingId, colour, placeIds } = parsed.data;

  const name = cleanRoundName(parsed.data.name);
  if (!name.ok) return { success: false, error: name.error };
  if (!isRoundColour(colour)) return { success: false, error: 'Pick a colour from the list.' };

  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Your account is not linked to a business.' };
  const db = await createClient();
  const wanted = [...new Set(placeIds)];

  // Every place must be an active one of this business.
  const found = new Set<string>();
  for (const part of chunks(wanted)) {
    const { data, error } = await db
      .from('service_agreements')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .in('id', part);
    if (error) return { success: false, error: 'Couldn’t check those customers. Try again.' };
    for (const row of data ?? []) found.add(String(row.id));
  }
  if (found.size !== wanted.length) {
    return { success: false, error: 'Some of those customers have changed. Refresh the map and try again.' };
  }

  let roundId: string;
  if (existingId) {
    const { data, error } = await db
      .from('rounds')
      .update({ name: name.name, colour })
      .eq('id', existingId)
      .eq('tenant_id', tenantId)
      .select('id');
    if (error) {
      if (error.code === '23505') return { success: false, error: `You already have a round called ${name.name}.` };
      return { success: false, error: 'Couldn’t save the round. Try again.' };
    }
    if (!data || data.length === 0) return { success: false, error: NOT_OWNER };
    roundId = existingId;
  } else {
    const { data, error } = await db
      .from('rounds')
      .insert({ tenant_id: tenantId, name: name.name, colour })
      .select('id')
      .single();
    if (error || !data) {
      if (error?.code === '23505') return { success: false, error: `You already have a round called ${name.name}.` };
      if (error?.code === '42501') return { success: false, error: NOT_OWNER };
      return { success: false, error: 'Couldn’t create the round. Try again.' };
    }
    roundId = String(data.id);
  }

  const { data: currentRows, error: currentError } = await db
    .from('service_agreements')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('round_id', roundId);
  if (currentError) return { success: false, error: 'The round was saved but its customers couldn’t be updated. Try again.' };
  const { add, remove } = membershipChanges((currentRows ?? []).map((r) => String(r.id)), wanted);

  for (const part of chunks(add)) {
    const { error } = await db.from('service_agreements').update({ round_id: roundId }).eq('tenant_id', tenantId).in('id', part);
    if (error) return { success: false, error: 'The round was saved but some customers couldn’t be added. Try again.' };
  }
  for (const part of chunks(remove)) {
    const { error } = await db
      .from('service_agreements')
      .update({ round_id: null })
      .eq('tenant_id', tenantId)
      .eq('round_id', roundId)
      .in('id', part);
    if (error) return { success: false, error: 'The round was saved but some customers couldn’t be removed. Try again.' };
  }

  refresh();
  return { success: true, id: roundId };
}

/** Deletes the round only. The customers in it stay, and are simply not in a round any more. */
export async function deleteRound(id: string): Promise<DeleteRoundResult> {
  if (!z.string().uuid().safeParse(id).success) return { success: false, error: 'That round doesn’t exist.' };
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Your account is not linked to a business.' };
  const db = await createClient();
  const { data, error } = await db.from('rounds').delete().eq('id', id).eq('tenant_id', tenantId).select('id');
  if (error) return { success: false, error: 'Couldn’t delete the round. Try again.' };
  if (!data || data.length === 0) return { success: false, error: NOT_OWNER };
  refresh();
  return { success: true };
}
