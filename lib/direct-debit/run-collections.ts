import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { collectForCustomer, resumeCollection } from '@/lib/direct-debit/collect';
import { directDebitState } from '@/lib/direct-debit/state';
import { processGoCardlessEvents, refreshCollection } from '@/lib/direct-debit/webhook';
import { refreshVerification } from '@/lib/gocardless/connection';
import { listRoundsTenantIds } from '@/lib/messaging/rounds-tenants';
import { formatGbp } from '@/lib/money/pence';
import { sendOrHoldOwnerPush } from '@/lib/push/owner-push';
import { londonDayBoundsUtc, todayInLondon } from '@/lib/rounds/dates';

const DEFAULT_DEADLINE_MS = 50_000;
const CREATING_STUCK_MS = 30 * 60 * 1000;
const PROCESSING_STALE_MS = 8 * 24 * 60 * 60 * 1000;
const SWEEP_LIMIT = 200;

type Row = Record<string, unknown>;

export type EveningTotals = {
  tenants: number;
  customers: number;
  created: number;
  amount: number;
  skipped: number;
  tooLarge: number;
  otherApp: number;
  errors: number;
  stoppedEarly: boolean;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Rounds businesses with a connected GoCardless account. Throws on a database error (nothing is collected blind). */
async function connectedRoundsTenants(admin: SupabaseClient): Promise<string[]> {
  const rounds = new Set(await listRoundsTenantIds(admin));
  if (rounds.size === 0) return [];
  const { data, error } = await admin
    .from('gocardless_connections')
    .select('tenant_id')
    .eq('status', 'connected');
  if (error) throw new Error(`Reading connections failed (${error.code ?? 'db'})`);
  return [
    ...new Set(
      ((data ?? []) as Row[])
        .map((r) => str(r.tenant_id))
        .filter((id): id is string => id != null && rounds.has(id)),
    ),
  ];
}

async function customerName(admin: SupabaseClient, tenantId: string, customerId: string): Promise<string> {
  const { data } = await admin
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return str((data as Row | null)?.name) ?? 'A customer';
}

/** Once per customer per London day per warning: this run's set, then any held push already stored today. */
async function alreadyWarned(
  admin: SupabaseClient,
  seen: Set<string>,
  p: { tenantId: string; customerId: string; title: string; now: Date },
): Promise<boolean> {
  const key = `${p.title}:${p.customerId}`;
  if (seen.has(key)) return true;
  seen.add(key);
  try {
    const { startIso } = londonDayBoundsUtc(todayInLondon(p.now));
    const { data, error } = await admin
      .from('owner_pushes')
      .select('id')
      .eq('tenant_id', p.tenantId)
      .eq('kind', 'dd_attention')
      .eq('title', p.title)
      .eq('data->>customerId', p.customerId)
      .gte('created_at', startIso)
      .limit(1);
    // A failed check errs towards telling the trader once more.
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

async function warn(
  admin: SupabaseClient,
  seen: Set<string>,
  p: { tenantId: string; customerId: string; title: string; body: (name: string) => string; amount?: number; now: Date },
): Promise<void> {
  if (await alreadyWarned(admin, seen, p)) return;
  const name = await customerName(admin, p.tenantId, p.customerId);
  await sendOrHoldOwnerPush(
    admin,
    p.tenantId,
    {
      kind: 'dd_attention',
      title: p.title,
      body: p.body(name),
      data: { type: 'dd_attention', customerId: p.customerId, customerName: name, ...(p.amount != null ? { amount: p.amount } : {}) },
    },
    p.now,
  );
}

/** T7: 18:00 UK. Collects for every Direct Debit customer of every Rounds business with Direct Debit on. */
export async function runEveningCollections(
  admin: SupabaseClient,
  p: { now?: Date; deadlineMs?: number } = {},
): Promise<EveningTotals> {
  const now = p.now ?? new Date();
  const started = Date.now();
  const deadline = p.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const totals: EveningTotals = {
    tenants: 0,
    customers: 0,
    created: 0,
    amount: 0,
    skipped: 0,
    tooLarge: 0,
    otherApp: 0,
    errors: 0,
    stoppedEarly: false,
  };
  const seen = new Set<string>();

  const tenantIds = await connectedRoundsTenants(admin);
  for (const tenantId of tenantIds) {
    if (Date.now() - started > deadline) {
      totals.stoppedEarly = true;
      break;
    }
    if (totals.stoppedEarly) break;
    try {
      // T9: a verified business can drop back — check every evening.
      const connection = await refreshVerification(admin, tenantId, { force: true, now });
      if (directDebitState(connection) !== 'on') continue;
      totals.tenants += 1;

      const { data, error } = await admin
        .from('customer_direct_debits')
        .select('customer_id')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'active']);
      if (error) throw new Error(`Reading Direct Debits failed (${error.code ?? 'db'})`);
      const customerIds = [
        ...new Set(((data ?? []) as Row[]).map((r) => str(r.customer_id)).filter((id): id is string => id != null)),
      ];

      for (const customerId of customerIds) {
        // A big business must not run the function out of time mid-call: the rest wait for tomorrow.
        if (Date.now() - started > deadline) {
          totals.stoppedEarly = true;
          break;
        }
        totals.customers += 1;
        try {
          const outcome = await collectForCustomer(admin, { tenantId, customerId, createdBy: 'cron', now });
          switch (outcome.kind) {
            case 'created':
              totals.created += 1;
              totals.amount = Math.round((totals.amount + outcome.amount) * 100) / 100;
              break;
            case 'skipped':
              totals.skipped += 1;
              break;
            case 'too_large':
              totals.tooLarge += 1;
              await warn(admin, seen, {
                tenantId,
                customerId,
                now,
                amount: outcome.amount,
                title: 'Direct Debit not collected',
                body: (name) =>
                  `${name} owes ${formatGbp(outcome.amount)} — over the £1,000 Direct Debit limit. Ask them to pay by card or transfer.`,
              });
              break;
            case 'other_app':
              totals.otherApp += 1;
              await warn(admin, seen, {
                tenantId,
                customerId,
                now,
                title: 'Not collected — another app',
                body: (name) =>
                  `${name}: another app is still collecting from their Direct Debit (${outcome.detail}). Switch it off; WorkWise will collect once it's clear.`,
              });
              break;
            case 'error':
              totals.errors += 1;
              console.error(`[dd evening] ${tenantId} ${customerId} ${outcome.message}`);
              break;
          }
        } catch (err) {
          totals.errors += 1;
          console.error(`[dd evening] ${tenantId} ${customerId} ${message(err)}`);
        }
      }
    } catch (err) {
      totals.errors += 1;
      console.error(`[dd evening] ${tenantId} ${message(err)}`);
    }
  }
  return totals;
}

/** 07:00: finish or check what already exists. Never creates a collection. */
export async function runMorningCollectionSweep(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<{
  eventsProcessed: number;
  eventsFailed: number;
  resumed: number;
  errored: number;
  refreshed: number;
  verificationsRefreshed: number;
}> {
  const out = { eventsProcessed: 0, eventsFailed: 0, resumed: 0, errored: 0, refreshed: 0, verificationsRefreshed: 0 };

  try {
    const events = await processGoCardlessEvents(admin, { olderThanMs: 2 * 60_000, now });
    out.eventsProcessed = events.processed;
    out.eventsFailed = events.failed;
  } catch (err) {
    console.error('[dd sweep] events', message(err));
  }

  try {
    const cutoff = new Date(now.getTime() - CREATING_STUCK_MS).toISOString();
    const { data, error } = await admin
      .from('direct_debit_collections')
      .select('id')
      .eq('status', 'creating')
      .lte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error) throw new Error(`Reading collections failed (${error.code ?? 'db'})`);
    for (const row of (data ?? []) as Row[]) {
      try {
        const outcome = await resumeCollection(admin, String(row.id), now);
        if (outcome.kind === 'created') out.resumed += 1;
        else if (outcome.kind === 'error') out.errored += 1;
      } catch (err) {
        out.errored += 1;
        console.error('[dd sweep] resume', String(row.id), message(err));
      }
    }
  } catch (err) {
    console.error('[dd sweep] creating', message(err));
  }

  try {
    const cutoff = new Date(now.getTime() - PROCESSING_STALE_MS).toISOString();
    const { data, error } = await admin
      .from('direct_debit_collections')
      .select('id')
      .eq('status', 'processing')
      .lte('submitted_at', cutoff)
      .order('submitted_at', { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error) throw new Error(`Reading collections failed (${error.code ?? 'db'})`);
    for (const row of (data ?? []) as Row[]) {
      if ((await refreshCollection(admin, String(row.id))) === 'updated') out.refreshed += 1;
    }
  } catch (err) {
    console.error('[dd sweep] processing', message(err));
  }

  try {
    const { data, error } = await admin
      .from('gocardless_connections')
      .select('tenant_id')
      .eq('status', 'connected');
    if (error) throw new Error(`Reading connections failed (${error.code ?? 'db'})`);
    for (const row of (data ?? []) as Row[]) {
      const tenantId = str(row.tenant_id);
      if (!tenantId) continue;
      try {
        await refreshVerification(admin, tenantId, { force: true, now });
        out.verificationsRefreshed += 1;
      } catch (err) {
        console.error('[dd sweep] verification', tenantId, message(err));
      }
    }
  } catch (err) {
    console.error('[dd sweep] connections', message(err));
  }

  return out;
}
