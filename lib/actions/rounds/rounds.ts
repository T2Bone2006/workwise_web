'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { cleanRoundName, isRoundColour, membershipChanges } from '@/lib/rounds/rounds';
import { releaseVisitsToOwner, repointAgreementVisits, repointRoundVisits, validAssignees } from '@/lib/team/assign';

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

  const tenantId = await getOwnerTenantId();
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

  // Places that joined a round follow its usual lead; places that left follow the owner again. Best effort: the round is saved either way.
  if (add.length > 0) {
    await repointRoundVisits(db, { tenantId, roundId, previousLeadWorkerId: null }).catch(() => 0);
  }
  if (remove.length > 0) {
    const { data: lead } = await db.from('rounds').select('usual_lead_worker_id').eq('id', roundId).eq('tenant_id', tenantId).maybeSingle();
    await releaseVisitsToOwner(db, {
      tenantId,
      agreementIds: remove,
      leadWorkerId: (lead as { usual_lead_worker_id?: string | null } | null)?.usual_lead_worker_id ?? null,
    }).catch(() => 0);
  }

  refresh();
  return { success: true, id: roundId };
}

/** Deletes the round only. The customers in it stay, and are simply not in a round any more. */
export async function deleteRound(id: string): Promise<DeleteRoundResult> {
  if (!z.string().uuid().safeParse(id).success) return { success: false, error: 'That round doesn’t exist.' };
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return { success: false, error: 'Your account is not linked to a business.' };
  const db = await createClient();
  // Remember who led it and which places were in it, so their upcoming visits can go back to the owner.
  const { data: before } = await db.from('rounds').select('usual_lead_worker_id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  const { data: places } = await db.from('service_agreements').select('id').eq('tenant_id', tenantId).eq('round_id', id);
  const { data, error } = await db.from('rounds').delete().eq('id', id).eq('tenant_id', tenantId).select('id');
  if (error) return { success: false, error: 'Couldn’t delete the round. Try again.' };
  if (!data || data.length === 0) return { success: false, error: NOT_OWNER };
  await releaseVisitsToOwner(db, {
    tenantId,
    agreementIds: (places ?? []).map((r) => String((r as { id: unknown }).id)),
    leadWorkerId: (before as { usual_lead_worker_id?: string | null } | null)?.usual_lead_worker_id ?? null,
  }).catch(() => 0);
  refresh();
  return { success: true };
}

export type SetAgreementRoundResult =
  | { success: true; roundName: string | null; leadName: string | null }
  | { success: false; error: string };

/**
 * Put one house in a round (or take it out). Its upcoming visits follow the round's usual lead, as they do when a house
 * is added to a round on the map. Visits the owner gave to someone else for a day are left alone.
 */
export async function setAgreementRound(agreementId: string, roundId: string | null): Promise<SetAgreementRoundResult> {
  if (!z.string().uuid().safeParse(agreementId).success) return { success: false, error: 'That customer doesn’t exist.' };
  if (roundId !== null && !z.string().uuid().safeParse(roundId).success) return { success: false, error: 'That round doesn’t exist.' };
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return { success: false, error: NOT_OWNER };
  const db = await createClient();

  const { data: agreement, error: agreementError } = await db
    .from('service_agreements')
    .select('id, round_id')
    .eq('id', agreementId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (agreementError || !agreement) return { success: false, error: 'That customer doesn’t exist.' };
  const previousRoundId = (agreement as { round_id: string | null }).round_id ?? null;
  if (previousRoundId === roundId) return { success: true, roundName: null, leadName: null };

  const readRound = async (id: string | null) => {
    if (!id) return null;
    const { data } = await db
      .from('rounds')
      .select('id, name, usual_lead_worker_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    return (data as { id: string; name: string; usual_lead_worker_id: string | null } | null) ?? null;
  };
  const [previous, next] = await Promise.all([readRound(previousRoundId), readRound(roundId)]);
  if (roundId && !next) return { success: false, error: 'That round doesn’t exist.' };

  const { error } = await db.from('service_agreements').update({ round_id: roundId }).eq('id', agreementId).eq('tenant_id', tenantId);
  if (error) return { success: false, error: 'Couldn’t save that. Try again.' };

  await repointAgreementVisits(db, {
    tenantId,
    agreementId,
    fromLeadWorkerId: previous?.usual_lead_worker_id ?? null,
    toLeadWorkerId: next?.usual_lead_worker_id ?? null,
  }).catch(() => 0);

  let leadName: string | null = null;
  if (next?.usual_lead_worker_id) {
    const assignees = await validAssignees(db, tenantId).catch(() => []);
    leadName = assignees.find((a) => a.workerId === next.usual_lead_worker_id)?.name ?? null;
  }
  refresh();
  revalidatePath('/calendar');
  return { success: true, roundName: next?.name ?? null, leadName };
}
