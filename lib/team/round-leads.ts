import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who normally does a round (rounds.usual_lead_worker_id). A leaf module on purpose: visit generation and one-off
 * visits import it, so it must not import anything that imports them back.
 */

/** round id → its usual lead's worker id, for rounds that have one. A read failure gives an empty map (visits fall back to the owner). */
export async function loadRoundLeads(supabase: SupabaseClient, tenantId: string): Promise<Map<string, string>> {
  const leads = new Map<string, string>();
  const { data, error } = await supabase
    .from('rounds')
    .select('id, usual_lead_worker_id')
    .eq('tenant_id', tenantId)
    .not('usual_lead_worker_id', 'is', null);
  if (error) {
    console.error('[round-leads] read:', error.message);
    return leads;
  }
  for (const row of data ?? []) {
    const r = row as { id?: unknown; usual_lead_worker_id?: unknown };
    if (typeof r.id === 'string' && typeof r.usual_lead_worker_id === 'string') leads.set(r.id, r.usual_lead_worker_id);
  }
  return leads;
}

/**
 * The usual lead for a customer's house, if all of the customer's active places that are in a round with a lead agree
 * (exactly one distinct lead). Otherwise null, and the visit stays the owner's.
 */
export async function leadForCustomer(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('service_agreements')
    .select('round_id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .not('round_id', 'is', null);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const leads = await loadRoundLeads(supabase, tenantId);
  const distinct = new Set<string>();
  for (const row of data) {
    const roundId = (row as { round_id?: unknown }).round_id;
    const lead = typeof roundId === 'string' ? leads.get(roundId) : undefined;
    if (lead) distinct.add(lead);
  }
  return distinct.size === 1 ? [...distinct][0]! : null;
}
