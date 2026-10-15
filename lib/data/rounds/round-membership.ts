import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllPages } from '@/lib/data/read-all-pages';
import type { RoundRow } from '@/lib/rounds/rounds';

export type RoundMembership = {
  rounds: RoundRow[];
  /** The round each active place is in. Places in no round are missing. */
  roundIdByAgreement: Map<string, string>;
  /** Every round a customer has a place in, in name order. */
  roundsByCustomer: Map<string, RoundRow[]>;
};

/**
 * The business's named rounds and who is in them. Returns null if they can't be
 * read (for example before the rounds migration has been run), so a page that
 * only decorates itself with rounds keeps working without them.
 */
export async function getRoundMembership(db: SupabaseClient, tenantId: string): Promise<RoundMembership | null> {
  try {
    const { data, error } = await db.from('rounds').select('id, name, colour').eq('tenant_id', tenantId).order('name');
    if (error) throw new Error(error.message);
    const rounds: RoundRow[] = (data ?? []).map((r) => ({ id: String(r.id), name: String(r.name), colour: String(r.colour) }));
    const byId = new Map(rounds.map((r) => [r.id, r]));

    const members = await readAllPages(
      (a, z) =>
        db
          .from('service_agreements')
          .select('id, customer_id, round_id')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .not('round_id', 'is', null)
          .order('id', { ascending: true })
          .range(a, z),
      'Could not load rounds',
    );

    const roundIdByAgreement = new Map<string, string>();
    const roundsByCustomer = new Map<string, RoundRow[]>();
    for (const m of members) {
      const agreementId = typeof m.id === 'string' ? m.id : null;
      const customerId = typeof m.customer_id === 'string' ? m.customer_id : null;
      const round = typeof m.round_id === 'string' ? byId.get(m.round_id) : undefined;
      if (!agreementId || !customerId || !round) continue;
      roundIdByAgreement.set(agreementId, round.id);
      const list = roundsByCustomer.get(customerId) ?? [];
      if (!list.some((r) => r.id === round.id)) list.push(round);
      roundsByCustomer.set(customerId, list);
    }
    for (const list of roundsByCustomer.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
    return { rounds, roundIdByAgreement, roundsByCustomer };
  } catch (err) {
    console.error('[getRoundMembership]', err instanceof Error ? err.message : 'failed');
    return null;
  }
}
