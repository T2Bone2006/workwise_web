import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export type ExistingDirectDebit = {
  linkId: string;
  payerName: string | null;
  payerEmail: string | null;
  payerPostcode: string | null;
  bankName: string | null;
  bankEnding: string | null;
  mandateStatus: string;
  mandateCreatedAt: string | null;
  otherCollections: number;
  otherCollectionsDetail: string | null;
  matchKind: 'email' | 'name_postcode' | 'none';
  suggested: { customerId: string; name: string } | null;
  decision: 'pending' | 'linked' | 'ignored';
  linked: { customerId: string; name: string } | null;
  canUnlink: boolean; // no collection yet
  /** Linked by the system (same email) rather than by a person. */
  linkedAutomatically: boolean;
};

type Row = Record<string, unknown>;

const LINKABLE_STATUSES = new Set(['pending_submission', 'submitted', 'active']);
const MATCH_ORDER = { email: 0, name_postcode: 1, none: 2 } as const;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The Direct Debits found in a switcher's GoCardless account (caller's RLS
 * client). toLink = pending with mandate_status pending_submission / submitted
 * / active; the others by decision. A read error gives empty lists.
 */
export async function getExistingDirectDebits(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{
  checkedAt: string | null;
  toLink: ExistingDirectDebit[];
  linked: ExistingDirectDebit[];
  ignored: ExistingDirectDebit[];
}> {
  const out = {
    checkedAt: null as string | null,
    toLink: [] as ExistingDirectDebit[],
    linked: [] as ExistingDirectDebit[],
    ignored: [] as ExistingDirectDebit[],
  };

  const [links, connection] = await Promise.all([
    supabase.from('gocardless_mandate_links').select('*').eq('tenant_id', tenantId),
    supabase
      .from('gocardless_connections')
      .select('mandates_checked_at')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);
  if (links.error) {
    console.error('[getExistingDirectDebits]', links.error.code);
    return out;
  }
  out.checkedAt = str((connection.data as Row | null)?.mandates_checked_at);

  const rows = (links.data ?? []) as Row[];
  const customerIds = new Set<string>();
  const ddIds = new Set<string>();
  for (const r of rows) {
    for (const key of ['suggested_customer_id', 'linked_customer_id'] as const) {
      const id = str(r[key]);
      if (id) customerIds.add(id);
    }
    const dd = str(r.direct_debit_id);
    if (dd) ddIds.add(dd);
  }

  const names = new Map<string, string>();
  if (customerIds.size > 0) {
    const { data } = await supabase
      .from('customers')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', [...customerIds]);
    for (const c of (data ?? []) as Row[]) {
      const id = str(c.id);
      if (id) names.set(id, str(c.name) ?? 'Customer');
    }
  }

  // A linked Direct Debit that already has a collection can't be undone.
  const withCollection = new Set<string>();
  if (ddIds.size > 0) {
    const { data, error } = await supabase
      .from('direct_debit_collections')
      .select('direct_debit_id')
      .eq('tenant_id', tenantId)
      .in('direct_debit_id', [...ddIds]);
    if (error) {
      // Can't tell → don't offer Undo.
      for (const id of ddIds) withCollection.add(id);
    }
    for (const c of (data ?? []) as Row[]) withCollection.add(String(c.direct_debit_id));
  }

  const person = (id: string | null) =>
    id && names.has(id) ? { customerId: id, name: names.get(id) as string } : null;

  for (const r of rows) {
    const decision = r.decision === 'linked' || r.decision === 'ignored' ? r.decision : 'pending';
    const matchKind =
      r.match_kind === 'email' || r.match_kind === 'name_postcode' ? r.match_kind : 'none';
    const dd = str(r.direct_debit_id);
    const item: ExistingDirectDebit = {
      linkId: String(r.id),
      payerName: str(r.payer_name),
      payerEmail: str(r.payer_email),
      payerPostcode: str(r.payer_postcode),
      bankName: str(r.bank_name),
      bankEnding: str(r.account_number_ending),
      mandateStatus: str(r.mandate_status) ?? '',
      mandateCreatedAt: str(r.mandate_created_at),
      otherCollections: Number(r.other_collections) || 0,
      otherCollectionsDetail: str(r.other_collections_detail),
      matchKind,
      suggested: person(str(r.suggested_customer_id)),
      decision,
      linked: person(str(r.linked_customer_id)),
      linkedAutomatically: decision === 'linked' && str(r.decided_by_user_id) == null,
      canUnlink: decision === 'ignored' || (decision === 'linked' && !(dd && withCollection.has(dd))),
    };
    if (decision === 'pending') {
      if (LINKABLE_STATUSES.has(item.mandateStatus)) out.toLink.push(item);
    } else if (decision === 'linked') out.linked.push(item);
    else out.ignored.push(item);
  }

  const byName = (a: ExistingDirectDebit, b: ExistingDirectDebit) =>
    (a.payerName ?? '').localeCompare(b.payerName ?? '', 'en-GB');
  out.toLink.sort((a, b) => MATCH_ORDER[a.matchKind] - MATCH_ORDER[b.matchKind] || byName(a, b));
  out.linked.sort(byName);
  out.ignored.sort(byName);
  return out;
}
