import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { GoCardlessError, type GoCardlessClient } from '@/lib/gocardless/client';
import { clientForTenant } from '@/lib/gocardless/connection';
import { matchPayer, type MatchCandidate } from '@/lib/direct-debit/match';
import { splitHouse } from '@/lib/rounds/house';

/**
 * D21/D22: Direct Debits already in a switcher's GoCardless account.
 * Reading only — nothing is created, changed or cancelled in GoCardless here.
 */

export type RefreshSummary = {
  found: number;
  autoLinked: number;
  probable: number;
  unmatched: number;
  otherApp: number;
};

export type LinkResult = { ok: true; directDebitId: string } | { ok: false; error: string };

const LIVE_MANDATE_STATUSES = new Set(['pending_submission', 'submitted', 'active']);
const WAITING_PAYMENT_STATUSES = new Set(['pending_submission', 'submitted']);
const UPSERT_CHUNK = 200;

const ALREADY_DEALT_WITH = 'This one has already been dealt with.';
const NOT_CONNECTED = 'Connect GoCardless first.';
const UNREACHABLE = "Couldn't reach GoCardless — try again.";

type GcMandate = {
  id: string;
  status?: string;
  reference?: string | null;
  created_at?: string | null;
  next_possible_charge_date?: string | null;
  metadata?: Record<string, unknown> | null;
  links?: { customer?: string; customer_bank_account?: string };
};
type GcCustomer = {
  id: string;
  email?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  company_name?: string | null;
  postal_code?: string | null;
};
type GcBankAccount = { id: string; bank_name?: string | null; account_number_ending?: string | null };
type GcCollectionLike = {
  id: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
  links?: { mandate?: string };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function clip(value: string | null, max: number): string | null {
  return value == null ? null : value.slice(0, max);
}

function payerName(c: GcCustomer | undefined): string | null {
  if (!c) return null;
  const person = [str(c.given_name), str(c.family_name)].filter(Boolean).join(' ');
  return person !== '' ? person : str(c.company_name);
}

function ending(value: unknown): string | null {
  const digits = str(value)?.replace(/\D/g, '') ?? '';
  return digits.length >= 2 ? digits.slice(-2) : null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function otherDetail(subscriptions: number, payments: number): string | null {
  const parts: string[] = [];
  if (subscriptions > 0) parts.push(plural(subscriptions, 'subscription', 'subscriptions'));
  if (payments > 0) parts.push(plural(payments, 'collection waiting', 'collections waiting'));
  return parts.length === 0 ? null : parts.join(', ');
}

/** T10: WorkWise's own payments carry workwise_collection_id of one of this business's collections. */
async function ourCollectionIds(
  admin: SupabaseClient,
  tenantId: string,
  items: GcCollectionLike[],
): Promise<Set<string>> {
  const claimed = [
    ...new Set(
      items
        .map((item) => str(item.metadata?.workwise_collection_id))
        .filter((id): id is string => id != null && UUID_RE.test(id)),
    ),
  ];
  if (claimed.length === 0) return new Set();
  const { data, error } = await admin
    .from('direct_debit_collections')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', claimed);
  if (error) throw new Error(`Could not read collections (${error.code ?? 'db'})`);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

/** Active subscriptions + waiting payments on each mandate that WorkWise didn't make. */
function countForeign(
  subscriptions: GcCollectionLike[],
  payments: GcCollectionLike[],
  ours: Set<string>,
): Map<string, { subscriptions: number; payments: number }> {
  const byMandate = new Map<string, { subscriptions: number; payments: number }>();
  const bump = (mandateId: string | undefined, key: 'subscriptions' | 'payments') => {
    if (!mandateId) return;
    const entry = byMandate.get(mandateId) ?? { subscriptions: 0, payments: 0 };
    entry[key] += 1;
    byMandate.set(mandateId, entry);
  };
  const isOurs = (item: GcCollectionLike) => {
    const id = str(item.metadata?.workwise_collection_id);
    return id != null && ours.has(id);
  };
  for (const s of subscriptions) {
    if (s.status === 'active' && !isOurs(s)) bump(s.links?.mandate, 'subscriptions');
  }
  for (const p of payments) {
    if (p.status && WAITING_PAYMENT_STATUSES.has(p.status) && !isOurs(p)) {
      bump(p.links?.mandate, 'payments');
    }
  }
  return byMandate;
}

async function matchCandidates(admin: SupabaseClient, tenantId: string): Promise<MatchCandidate[]> {
  const [{ data: customers, error }, { data: liveDebits, error: debitsError }] = await Promise.all([
    admin
      .from('customers')
      .select('id, name, email, billing_address, service_agreements(postcode)')
      .eq('tenant_id', tenantId)
      .eq('is_active', true),
    admin
      .from('customer_direct_debits')
      .select('customer_id')
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'active']),
  ]);
  if (error) throw new Error(`Could not read customers (${error.code ?? 'db'})`);
  if (debitsError) throw new Error(`Could not read Direct Debits (${debitsError.code ?? 'db'})`);

  const live = new Set(
    ((liveDebits ?? []) as { customer_id?: unknown }[])
      .map((row) => str(row.customer_id))
      .filter((id): id is string => id != null),
  );

  const out: MatchCandidate[] = [];
  for (const raw of (customers ?? []) as Record<string, unknown>[]) {
    const customerId = str(raw.id);
    const name = str(raw.name);
    if (!customerId || !name) continue;
    const postcodes = new Set<string>();
    const home = splitHouse(str(raw.billing_address));
    if (home.postcode) postcodes.add(home.postcode);
    const agreements = Array.isArray(raw.service_agreements) ? raw.service_agreements : [];
    for (const agreement of agreements) {
      const postcode = str((agreement as { postcode?: unknown }).postcode);
      if (postcode) postcodes.add(postcode);
    }
    out.push({
      customerId,
      email: str(raw.email),
      name,
      postcodes: [...postcodes],
      hasLiveDirectDebit: live.has(customerId),
    });
  }
  return out;
}

/**
 * Reads GoCardless, upserts gocardless_mandate_links, auto-links email matches
 * with no other collections. Sets gocardless_connections.mandates_checked_at.
 * Throws when GoCardless can't be read (callers catch).
 */
export async function refreshMandateLinks(
  admin: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<RefreshSummary> {
  const summary: RefreshSummary = { found: 0, autoLinked: 0, probable: 0, unmatched: 0, otherApp: 0 };

  // 1.
  const unlocked = await clientForTenant(admin, tenantId);
  if (!unlocked) return summary;
  const { client, connection } = unlocked;
  const organisationId = connection.organisation_id;
  if (!organisationId) return summary;

  // 2.
  const [mandates, customers, bankAccounts, subscriptions, pendingPayments, submittedPayments] =
    await Promise.all([
      client.listAll<GcMandate>('/mandates', 'mandates'),
      client.listAll<GcCustomer>('/customers', 'customers'),
      client.listAll<GcBankAccount>('/customer_bank_accounts', 'customer_bank_accounts'),
      client.listAll<GcCollectionLike>('/subscriptions', 'subscriptions', { status: 'active' }),
      client.listAll<GcCollectionLike>('/payments', 'payments', { status: 'pending_submission' }),
      client.listAll<GcCollectionLike>('/payments', 'payments', { status: 'submitted' }),
    ]);
  const payments = [...pendingPayments, ...submittedPayments];

  // 3. Live mandates that WorkWise didn't make and hasn't already got.
  const { data: knownRows, error: knownError } = await admin
    .from('customer_direct_debits')
    .select('gocardless_mandate_id')
    .eq('tenant_id', tenantId)
    .not('gocardless_mandate_id', 'is', null);
  if (knownError) throw new Error(`Could not read Direct Debits (${knownError.code ?? 'db'})`);
  const known = new Set(
    ((knownRows ?? []) as { gocardless_mandate_id?: unknown }[])
      .map((row) => str(row.gocardless_mandate_id))
      .filter((id): id is string => id != null),
  );
  const kept = mandates.filter(
    (m) =>
      str(m.id) != null &&
      m.status != null &&
      LIVE_MANDATE_STATUSES.has(m.status) &&
      str(m.metadata?.workwise_tenant_id) == null &&
      !known.has(m.id),
  );
  summary.found = kept.length;
  if (kept.length > 0) {
    // 4.
    const customersById = new Map(customers.map((c) => [c.id, c]));
    const banksById = new Map(bankAccounts.map((b) => [b.id, b]));
    const ours = await ourCollectionIds(admin, tenantId, [...subscriptions, ...payments]);
    const foreign = countForeign(subscriptions, payments, ours);
    const seenAt = now.toISOString();

    const facts = kept.map((m) => {
      const payer = customersById.get(m.links?.customer ?? '');
      const bank = banksById.get(m.links?.customer_bank_account ?? '');
      const other = foreign.get(m.id) ?? { subscriptions: 0, payments: 0 };
      const otherCount = other.subscriptions + other.payments;
      if (otherCount > 0) summary.otherApp += 1;
      return {
        tenant_id: tenantId,
        gocardless_organisation_id: organisationId,
        gocardless_mandate_id: m.id,
        gocardless_customer_id: str(m.links?.customer),
        mandate_status: m.status as string,
        mandate_reference: clip(str(m.reference), 40),
        mandate_created_at: str(m.created_at),
        payer_name: clip(payerName(payer), 140),
        payer_email: clip(str(payer?.email), 254),
        payer_postcode: clip(str(payer?.postal_code), 12),
        bank_name: clip(str(bank?.bank_name), 80),
        account_number_ending: ending(bank?.account_number_ending),
        other_collections: otherCount,
        other_collections_detail: otherDetail(other.subscriptions, other.payments),
        last_seen_at: seenAt,
      };
    });

    // 5. Facts only: decision / linked_customer_id / direct_debit_id are never in the payload.
    for (let i = 0; i < facts.length; i += UPSERT_CHUNK) {
      const { error } = await admin
        .from('gocardless_mandate_links')
        .upsert(facts.slice(i, i + UPSERT_CHUNK), { onConflict: 'tenant_id,gocardless_mandate_id' });
      if (error) throw new Error(`Could not save Direct Debits (${error.code ?? 'db'})`);
    }

    // 6. Match the ones still waiting for a decision.
    const { data: pendingRows, error: pendingError } = await admin
      .from('gocardless_mandate_links')
      .select('id, gocardless_mandate_id, payer_name, payer_email, payer_postcode, other_collections')
      .eq('tenant_id', tenantId)
      .eq('decision', 'pending');
    if (pendingError) throw new Error(`Could not read Direct Debits (${pendingError.code ?? 'db'})`);

    const candidates = await matchCandidates(admin, tenantId);
    const keptIds = new Set(kept.map((m) => m.id));
    for (const raw of (pendingRows ?? []) as Record<string, unknown>[]) {
      const linkId = str(raw.id);
      // Only the ones GoCardless still lists as live (7).
      if (!linkId || !keptIds.has(str(raw.gocardless_mandate_id) ?? '')) continue;
      const match = matchPayer(
        {
          email: str(raw.payer_email),
          name: str(raw.payer_name),
          postcode: str(raw.payer_postcode),
        },
        candidates,
      );
      await admin
        .from('gocardless_mandate_links')
        .update({ match_kind: match.kind, suggested_customer_id: match.customerId })
        .eq('id', linkId)
        .eq('tenant_id', tenantId)
        .eq('decision', 'pending');

      const otherCount = typeof raw.other_collections === 'number' ? raw.other_collections : 0;
      if (match.kind === 'email' && match.customerId && otherCount === 0) {
        const linked = await linkExistingMandate(admin, {
          tenantId,
          userId: null,
          linkId,
          customerId: match.customerId,
          confirmStoppedOldApp: false,
        });
        if (linked.ok) {
          summary.autoLinked += 1;
          const candidate = candidates.find((c) => c.customerId === match.customerId);
          if (candidate) candidate.hasLiveDirectDebit = true;
          continue;
        }
      }
      if (match.kind === 'none') summary.unmatched += 1;
      else summary.probable += 1;
    }
  }

  // 7. Mandates GoCardless no longer returns keep their last status.
  // 8.
  await admin
    .from('gocardless_connections')
    .update({ mandates_checked_at: now.toISOString() })
    .eq('tenant_id', tenantId);

  return summary;
}

async function readMandate(
  client: GoCardlessClient,
  mandateId: string,
): Promise<{ mandate: GcMandate | null; error: string | null }> {
  try {
    const json = await client.get<{ mandates?: GcMandate }>(`/mandates/${encodeURIComponent(mandateId)}`);
    return { mandate: json.mandates ?? null, error: null };
  } catch (err) {
    if (err instanceof GoCardlessError && err.status === 404) return { mandate: null, error: null };
    console.error('[direct-debit] read mandate', err instanceof GoCardlessError ? err.status : 'error');
    return { mandate: null, error: UNREACHABLE };
  }
}

/** Links one pending mandate link to a customer. confirmStoppedOldApp is required (true) when other_collections > 0. */
export async function linkExistingMandate(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    userId: string | null;
    linkId: string;
    customerId: string;
    confirmStoppedOldApp: boolean;
  },
): Promise<LinkResult> {
  // 1.
  const { data: linkData } = await admin
    .from('gocardless_mandate_links')
    .select(
      'id, decision, gocardless_organisation_id, gocardless_mandate_id, gocardless_customer_id, bank_name, account_number_ending, mandate_reference, other_collections',
    )
    .eq('id', p.linkId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  const link = linkData as Record<string, unknown> | null;
  if (!link || link.decision !== 'pending') return { ok: false, error: ALREADY_DEALT_WITH };

  const { data: customer } = await admin
    .from('customers')
    .select('id, name, is_active')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  const c = customer as { id?: string; name?: string; is_active?: boolean | null } | null;
  if (!c?.id || c.is_active === false) return { ok: false, error: 'Customer not found.' };

  const { data: live } = await admin
    .from('customer_direct_debits')
    .select('id')
    .eq('tenant_id', p.tenantId)
    .eq('customer_id', p.customerId)
    .in('status', ['pending', 'active'])
    .limit(1);
  if (Array.isArray(live) && live.length > 0) {
    return { ok: false, error: `${str(c.name) ?? 'This customer'} already has a Direct Debit.` };
  }

  // 2.
  const otherCount = typeof link.other_collections === 'number' ? link.other_collections : 0;
  if (otherCount > 0 && !p.confirmStoppedOldApp) {
    return {
      ok: false,
      error:
        'Another app is still collecting from this Direct Debit. Stop it in your old app first, then tick the box.',
    };
  }

  // 3.
  const mandateId = str(link.gocardless_mandate_id);
  if (!mandateId) return { ok: false, error: ALREADY_DEALT_WITH };
  const unlocked = await clientForTenant(admin, p.tenantId);
  if (!unlocked) return { ok: false, error: NOT_CONNECTED };
  const { mandate, error: readError } = await readMandate(unlocked.client, mandateId);
  if (readError) return { ok: false, error: readError };
  if (!mandate?.status || !LIVE_MANDATE_STATUSES.has(mandate.status)) {
    await admin
      .from('gocardless_mandate_links')
      .update({ mandate_status: mandate?.status ?? 'cancelled' })
      .eq('id', p.linkId)
      .eq('tenant_id', p.tenantId);
    return { ok: false, error: 'This Direct Debit is no longer active in GoCardless.' };
  }

  // 4.
  const now = new Date().toISOString();
  const active = mandate.status === 'active';
  const { data: inserted, error: insertError } = await admin
    .from('customer_direct_debits')
    .insert({
      tenant_id: p.tenantId,
      customer_id: p.customerId,
      gocardless_organisation_id: str(link.gocardless_organisation_id),
      gocardless_customer_id: str(link.gocardless_customer_id),
      gocardless_mandate_id: mandateId,
      source: 'imported',
      status: active ? 'active' : 'pending',
      bank_name: str(link.bank_name),
      account_number_ending: str(link.account_number_ending),
      mandate_reference: clip(str(mandate.reference) ?? str(link.mandate_reference), 40),
      next_possible_charge_date: str(mandate.next_possible_charge_date),
      activated_at: active ? now : null,
      other_collections_confirmed_at: p.confirmStoppedOldApp ? now : null,
    })
    .select('id')
    .maybeSingle();
  if (insertError) {
    if (insertError.code === '23505') {
      return { ok: false, error: 'This Direct Debit or customer is already linked.' };
    }
    console.error('[direct-debit] link insert', insertError.code);
    return { ok: false, error: 'Could not link this Direct Debit.' };
  }
  const directDebitId = str((inserted as { id?: unknown } | null)?.id);
  if (!directDebitId) return { ok: false, error: 'Could not link this Direct Debit.' };

  // 5.
  const { data: decided } = await admin
    .from('gocardless_mandate_links')
    .update({
      decision: 'linked',
      linked_customer_id: p.customerId,
      direct_debit_id: directDebitId,
      decided_at: now,
      decided_by_user_id: p.userId,
    })
    .eq('id', p.linkId)
    .eq('tenant_id', p.tenantId)
    .eq('decision', 'pending')
    .select('id');
  if (!Array.isArray(decided) || decided.length === 0) {
    await admin.from('customer_direct_debits').delete().eq('id', directDebitId).eq('tenant_id', p.tenantId);
    return { ok: false, error: ALREADY_DEALT_WITH };
  }

  // 6.
  return { ok: true, directDebitId };
}

export async function ignoreExistingMandate(
  admin: SupabaseClient,
  p: { tenantId: string; userId: string; linkId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await admin
    .from('gocardless_mandate_links')
    .update({
      decision: 'ignored',
      decided_at: new Date().toISOString(),
      decided_by_user_id: p.userId,
    })
    .eq('id', p.linkId)
    .eq('tenant_id', p.tenantId)
    .eq('decision', 'pending')
    .select('id');
  if (!Array.isArray(data) || data.length === 0) return { ok: false, error: ALREADY_DEALT_WITH };
  return { ok: true };
}

/**
 * Undo: a 'linked' row with no collection yet → deletes its
 * customer_direct_debits row, back to 'pending'; an 'ignored' row → back to
 * 'pending'. A linked row with any collection is refused.
 */
export async function unlinkExistingMandate(
  admin: SupabaseClient,
  p: { tenantId: string; userId: string; linkId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await admin
    .from('gocardless_mandate_links')
    .select('id, decision, direct_debit_id')
    .eq('id', p.linkId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  const link = data as { decision?: string; direct_debit_id?: string | null } | null;
  if (!link) return { ok: false, error: 'Not found.' };
  if (link.decision === 'pending') return { ok: true };

  const reset = {
    decision: 'pending',
    linked_customer_id: null,
    direct_debit_id: null,
    decided_at: null,
    decided_by_user_id: null,
  };

  if (link.decision === 'linked' && link.direct_debit_id) {
    const { data: collections, error: collectionsError } = await admin
      .from('direct_debit_collections')
      .select('id')
      .eq('tenant_id', p.tenantId)
      .eq('direct_debit_id', link.direct_debit_id)
      .limit(1);
    if (collectionsError) return { ok: false, error: 'Could not undo this — try again.' };
    if (Array.isArray(collections) && collections.length > 0) {
      return {
        ok: false,
        error: 'Collections have been made on this Direct Debit — cancel it on the customer instead.',
      };
    }
    // Delete first: the link row's direct_debit_id is ON DELETE SET NULL, and
    // a retry of a half-done undo lands in the plain reset below.
    const { error: deleteError } = await admin
      .from('customer_direct_debits')
      .delete()
      .eq('id', link.direct_debit_id)
      .eq('tenant_id', p.tenantId)
      .eq('source', 'imported');
    if (deleteError) {
      console.error('[direct-debit] unlink delete', deleteError.code);
      return { ok: false, error: 'Could not undo this — try again.' };
    }
  }

  const { data: reverted } = await admin
    .from('gocardless_mandate_links')
    .update(reset)
    .eq('id', p.linkId)
    .eq('tenant_id', p.tenantId)
    .eq('decision', link.decision ?? 'ignored')
    .select('id');
  if (!Array.isArray(reverted) || reverted.length === 0) return { ok: false, error: ALREADY_DEALT_WITH };
  return { ok: true };
}

/**
 * D22(b), used by step 12 before collecting from a source 'imported' Direct
 * Debit: waiting payments and active subscriptions on the mandate whose
 * metadata.workwise_collection_id isn't one of this business's collections.
 */
export async function otherAppCollections(
  admin: SupabaseClient,
  p: { tenantId: string; mandateId: string },
): Promise<{ count: number; detail: string } | { error: string }> {
  const unlocked = await clientForTenant(admin, p.tenantId);
  if (!unlocked) return { error: 'GoCardless is not connected.' };
  try {
    const { client } = unlocked;
    const [pending, submitted, subscriptions] = await Promise.all([
      client.listAll<GcCollectionLike>('/payments', 'payments', {
        mandate: p.mandateId,
        status: 'pending_submission',
      }),
      client.listAll<GcCollectionLike>('/payments', 'payments', {
        mandate: p.mandateId,
        status: 'submitted',
      }),
      client.listAll<GcCollectionLike>('/subscriptions', 'subscriptions', {
        mandate: p.mandateId,
        status: 'active',
      }),
    ]);
    const onMandate = (item: GcCollectionLike) => (item.links?.mandate ?? p.mandateId) === p.mandateId;
    const payments = [...pending, ...submitted].filter(onMandate);
    const subs = subscriptions.filter(onMandate);
    const ours = await ourCollectionIds(admin, p.tenantId, [...payments, ...subs]);
    const counted = countForeign(
      subs.map((s) => ({ ...s, links: { mandate: p.mandateId } })),
      payments.map((x) => ({ ...x, links: { mandate: p.mandateId } })),
      ours,
    ).get(p.mandateId) ?? { subscriptions: 0, payments: 0 };
    return {
      count: counted.subscriptions + counted.payments,
      detail: otherDetail(counted.subscriptions, counted.payments) ?? '',
    };
  } catch (err) {
    console.error(
      '[direct-debit] otherAppCollections',
      err instanceof GoCardlessError ? { status: err.status, type: err.type } : 'error',
    );
    return { error: UNREACHABLE };
  }
}
