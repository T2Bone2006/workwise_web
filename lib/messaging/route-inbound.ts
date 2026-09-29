import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { listRoundsTenantIds } from '@/lib/messaging/rounds-tenants';
import { ensureThread } from '@/lib/messaging/threads';
import { todayInLondon } from '@/lib/rounds/dates';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-transitions';

export type InboundRoute =
  | {
      kind: 'thread';
      tenantId: string;
      customerId: string;
      threadId: string;
      boundJobIds: string[];
    }
  | { kind: 'unknown' };

const WEEK_MS = 7 * 86_400_000;

const OPEN_STATUSES = new Set<string>(RESCHEDULE_STATUSES);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => asRecord(row) != null);
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    const id = asId(item);
    if (id) ids.push(id);
  }
  return ids;
}

function asYmd(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  return value.slice(0, 10);
}

type ThreadHit = {
  id: string;
  tenantId: string;
  customerId: string;
  activeJobIds: string[];
  activeSetAt: string | null;
};

function threadHit(raw: unknown): ThreadHit | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asId(row.id);
  const tenantId = asId(row.tenant_id);
  const customerId = asId(row.customer_id);
  if (!id || !tenantId || !customerId) return null;
  return {
    id,
    tenantId,
    customerId,
    activeJobIds: asIdList(row.active_job_ids),
    activeSetAt: typeof row.active_set_at === 'string' ? row.active_set_at : null,
  };
}

async function boundJobIds(
  admin: SupabaseClient,
  tenantId: string,
  thread: { activeJobIds: string[]; activeSetAt: string | null },
  now: Date,
): Promise<string[]> {
  if (thread.activeJobIds.length === 0 || thread.activeSetAt == null) return [];
  const setAt = new Date(thread.activeSetAt);
  if (Number.isNaN(setAt.getTime())) return [];
  if (setAt.getTime() < now.getTime() - WEEK_MS) return [];

  const { data, error } = await admin
    .from('jobs')
    .select('id, status, scheduled_date')
    .eq('tenant_id', tenantId)
    .in('id', thread.activeJobIds);
  if (error) {
    console.error('[routeInbound] jobs', error.message);
    return [];
  }

  const today = todayInLondon(now);
  const byId = new Map<string, { status: string; scheduledDate: string | null }>();
  for (const raw of asRows(data)) {
    const id = asId(raw.id);
    const status = asId(raw.status);
    if (!id || !status) continue;
    byId.set(id, { status, scheduledDate: asYmd(raw.scheduled_date) });
  }

  const kept: string[] = [];
  for (const id of thread.activeJobIds) {
    const job = byId.get(id);
    if (!job) continue;
    if (!OPEN_STATUSES.has(job.status)) continue;
    if (!job.scheduledDate || job.scheduledDate < today) continue;
    kept.push(id);
  }
  return kept;
}

async function routeFromCustomers(
  admin: SupabaseClient,
  from: string,
  rounds: Set<string>,
  now: Date,
): Promise<InboundRoute> {
  const { data, error } = await admin
    .from('customers')
    .select('id, tenant_id, updated_at')
    .eq('phone_e164', from)
    .eq('is_active', true);
  if (error) throw new Error(error.message);

  const matches: { id: string; tenantId: string; updatedAt: string }[] = [];
  for (const raw of asRows(data)) {
    const id = asId(raw.id);
    const tenantId = asId(raw.tenant_id);
    if (!id || !tenantId || !rounds.has(tenantId)) continue;
    matches.push({
      id,
      tenantId,
      updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    });
  }

  const tenants = new Set(matches.map((row) => row.tenantId));
  if (tenants.size !== 1) return { kind: 'unknown' };

  const tenantId = [...tenants][0]!;
  const customer = matches
    .filter((row) => row.tenantId === tenantId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
  if (!customer) return { kind: 'unknown' };

  const threadId = await ensureThread(admin, {
    tenantId,
    customerId: customer.id,
    phone: from,
  });
  const { data: threadRow, error: threadError } = await admin
    .from('message_threads')
    .select('id, tenant_id, customer_id, active_job_ids, active_set_at')
    .eq('id', threadId)
    .maybeSingle();
  if (threadError) throw new Error(threadError.message);
  const thread = threadHit(threadRow) ?? {
    id: threadId,
    tenantId,
    customerId: customer.id,
    activeJobIds: [],
    activeSetAt: null,
  };
  return {
    kind: 'thread',
    tenantId,
    customerId: customer.id,
    threadId,
    boundJobIds: await boundJobIds(admin, tenantId, thread, now),
  };
}

export async function routeInbound(
  admin: SupabaseClient,
  from: string,
  now: Date,
): Promise<InboundRoute> {
  const rounds = new Set(await listRoundsTenantIds(admin));

  const { data, error } = await admin
    .from('message_threads')
    .select('id, tenant_id, customer_id, active_job_ids, active_set_at, last_outbound_at')
    .eq('customer_address', from)
    .order('last_outbound_at', { ascending: false, nullsFirst: false })
    .limit(10);
  if (error) throw new Error(error.message);

  for (const raw of asRows(data)) {
    const thread = threadHit(raw);
    if (!thread || !rounds.has(thread.tenantId)) continue;
    return {
      kind: 'thread',
      tenantId: thread.tenantId,
      customerId: thread.customerId,
      threadId: thread.id,
      boundJobIds: await boundJobIds(admin, thread.tenantId, thread, now),
    };
  }

  return routeFromCustomers(admin, from, rounds, now);
}
