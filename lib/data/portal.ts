import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addDays, londonToday, weekStartOf } from '@/lib/portal/dates';
import {
  buildOverview,
  incompleteReason,
  NOT_STARTED_STATUSES,
  toAttentionItem,
  type AttentionItem,
  type PortalJobRow,
  type PortalOverviewData,
} from '@/lib/portal/overview';
import type { PortalTenantOption } from '@/components/portal/tenant-selector';
import { buildTimeline, type HistoryRow, type TimelineEvent } from '@/lib/portal/timeline';
import type { PortalJobView } from '@/lib/portal/job';

const JOB_COLUMNS =
  'id, reference_number, address, status, scheduled_date, scheduled_time, completed_at, arrived_at, updated_at, industry_data';

export type PortalPhoto = { id: string; url: string; name: string };
export type PortalDocument = { id: string; url: string; name: string };

type AttachmentRow = { id: string; job_id?: string; file_name: string; file_url: string; file_type: string | null };

export function isImageAttachment(row: Pick<AttachmentRow, 'file_type' | 'file_url'>): boolean {
  if (row.file_type?.toLowerCase().startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(row.file_url);
}

/**
 * Everything the customer's home page needs about their jobs with one provider.
 * Row access is enforced by the database for the signed-in customer, the same as
 * the jobs table below it.
 */
export async function getPortalOverview(customerId: string): Promise<PortalOverviewData> {
  const supabase = await createClient();
  const today = londonToday();

  const [windowResult, incompleteResult, overdueResult] = await Promise.all([
    supabase
      .from('jobs')
      .select(JOB_COLUMNS)
      .eq('customer_id', customerId)
      .gte('scheduled_date', addDays(today, -30))
      .lte('scheduled_date', addDays(weekStartOf(today), 6))
      .limit(2000),
    supabase
      .from('jobs')
      .select(JOB_COLUMNS, { count: 'exact' })
      .eq('customer_id', customerId)
      .eq('status', 'incomplete')
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('jobs')
      .select(JOB_COLUMNS, { count: 'exact' })
      .eq('customer_id', customerId)
      .in('status', [...NOT_STARTED_STATUSES])
      .lt('scheduled_date', today)
      .order('scheduled_date', { ascending: false })
      .limit(50),
  ]);

  if (windowResult.error) console.error('[getPortalOverview] window', windowResult.error);
  if (incompleteResult.error) console.error('[getPortalOverview] incomplete', incompleteResult.error);
  if (overdueResult.error) console.error('[getPortalOverview] overdue', overdueResult.error);

  const incomplete = (incompleteResult.data ?? []) as PortalJobRow[];
  const overdue = (overdueResult.data ?? []) as PortalJobRow[];
  const data = buildOverview(
    {
      rows: (windowResult.data ?? []) as PortalJobRow[],
      incomplete,
      overdue,
      incompleteTotal: incompleteResult.count ?? incomplete.length,
      overdueTotal: overdueResult.count ?? overdue.length,
    },
    today,
  );

  return { ...data, attention: await withPhotos(supabase, data.attention) };
}

/** A photo from the visit beside each not-completed job: proof, at a glance. */
async function withPhotos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: AttentionItem[],
): Promise<AttentionItem[]> {
  const ids = items.filter((a) => a.kind === 'not_completed').map((a) => a.id);
  if (ids.length === 0) return items;

  // The portal login cannot read the attachments table, so photos come through a narrow
  // database function that only returns images of this customer's own jobs.
  const { data: files, error } = await supabase.rpc('portal_job_photos', { p_job_ids: ids });
  if (error) {
    console.error('[withPhotos]', error);
    return items;
  }

  const photos = new Map<string, { first: string; count: number }>();
  for (const file of (files ?? []) as AttachmentRow[]) {
    if (!file.job_id || !isImageAttachment(file)) continue;
    const seen = photos.get(file.job_id);
    if (seen) seen.count += 1;
    else photos.set(file.job_id, { first: file.file_url, count: 1 });
  }

  return items.map((item) => {
    const found = photos.get(item.id);
    return found ? { ...item, photoUrl: found.first, photoCount: found.count } : item;
  });
}

export const ATTENTION_PAGE_SIZE = 15;

export type AttentionKindFilter = 'all' | 'not_completed' | 'overdue';

export type PortalAttentionPage = {
  items: AttentionItem[];
  /** Counts for the tabs, before the search is applied. */
  counts: { all: number; not_completed: number; overdue: number };
  /** Rows matching the current tab and search. */
  total: number;
  page: number;
};

/** Keep a search box from breaking the database filter it is put into. */
export function cleanSearch(raw: string | undefined): string {
  return (raw ?? '').replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Every not-completed and overdue job of the customer, one page at a time, for the Needs
 * attention page. Not completed come first (newest first), then overdue (most recently
 * missed first), so the page reads as one list however long it gets.
 */
export async function getPortalAttentionPage(
  customerId: string,
  options: { kind: AttentionKindFilter; search?: string; page: number },
): Promise<PortalAttentionPage> {
  const supabase = await createClient();
  const today = londonToday();
  const search = cleanSearch(options.search);
  const page = Math.max(1, options.page);

  const base = (kind: 'not_completed' | 'overdue', head: boolean, searched: boolean) => {
    let q = supabase
      .from('jobs')
      .select(head ? 'id' : JOB_COLUMNS, head ? { count: 'exact', head: true } : { count: 'exact' })
      .eq('customer_id', customerId);
    q = kind === 'not_completed' ? q.eq('status', 'incomplete') : q.in('status', [...NOT_STARTED_STATUSES]).lt('scheduled_date', today);
    if (searched && search) q = q.or(`reference_number.ilike.%${search}%,address.ilike.%${search}%`);
    return q;
  };

  const [ncAll, odAll, ncMatch, odMatch] = await Promise.all([
    base('not_completed', true, false),
    base('overdue', true, false),
    options.search ? base('not_completed', true, true) : Promise.resolve(null),
    options.search ? base('overdue', true, true) : Promise.resolve(null),
  ]);
  const counts = {
    not_completed: ncAll.count ?? 0,
    overdue: odAll.count ?? 0,
    all: (ncAll.count ?? 0) + (odAll.count ?? 0),
  };
  const matchNc = (ncMatch ?? ncAll).count ?? 0;
  const matchOd = (odMatch ?? odAll).count ?? 0;
  const lists: Array<'not_completed' | 'overdue'> =
    options.kind === 'all' ? ['not_completed', 'overdue'] : [options.kind];
  const sizes = { not_completed: matchNc, overdue: matchOd };
  const total = lists.reduce((sum, kind) => sum + sizes[kind], 0);

  // The page is a window onto the lists laid end to end.
  const from = (page - 1) * ATTENTION_PAGE_SIZE;
  const to = from + ATTENTION_PAGE_SIZE;
  const items: AttentionItem[] = [];
  let offset = 0;
  for (const kind of lists) {
    const size = sizes[kind];
    const start = Math.max(from - offset, 0);
    const end = Math.min(to - offset, size);
    offset += size;
    if (end <= start) continue;
    const { data, error } = await base(kind, false, true)
      .order(kind === 'not_completed' ? 'updated_at' : 'scheduled_date', { ascending: false })
      .range(start, end - 1);
    if (error) {
      console.error('[getPortalAttentionPage]', error);
      continue;
    }
    for (const row of (data ?? []) as unknown as PortalJobRow[]) items.push(toAttentionItem(row, kind, today));
  }

  return { items: await withPhotos(supabase, items), counts, total, page };
}

export type PortalAccess =
  | { status: 'signed_out' }
  | { status: 'none' }
  | { status: 'ok'; options: PortalTenantOption[]; customerId: string; tenantName: string };

type TenantRef = { id: string; name: string };
type CustomerRef = { id: string; name: string; tenant_id: string; tenants: TenantRef | TenantRef[] | null };

/**
 * Which provider's jobs this login is looking at: the one in `?tenant=` when it is theirs,
 * otherwise their first. Shared by every portal page.
 */
export async function getPortalAccess(tenantParam: string | undefined, touch = false): Promise<PortalAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'signed_out' };

  const { data: portalRows, error } = await supabase
    .from('customer_portal_users')
    .select('customer_id, customers ( id, name, tenant_id, tenants ( id, name ) )')
    .eq('user_id', user.id);
  if (error) console.error('[getPortalAccess] customer_portal_users:', error);

  const options: PortalTenantOption[] = [];
  for (const row of (portalRows ?? []) as Array<{ customers?: CustomerRef | CustomerRef[] | null }>) {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    if (!customer?.id) continue;
    const tenants = customer.tenants;
    const name = (Array.isArray(tenants) ? tenants[0]?.name : tenants?.name)?.trim() || 'Unknown';
    options.push({ customerId: customer.id, tenantName: name });
  }
  if (options.length === 0) return { status: 'none' };

  const wanted = tenantParam?.trim();
  const chosen = options.find((o) => o.customerId === wanted) ?? options[0]!;

  if (touch) {
    await supabase.from('customers').update({ portal_last_accessed_at: new Date().toISOString() }).eq('id', chosen.customerId);
  }
  return { status: 'ok', options, customerId: chosen.customerId, tenantName: chosen.tenantName };
}

export function splitAttachments(rows: AttachmentRow[]): { photos: PortalPhoto[]; documents: PortalDocument[] } {
  const photos: PortalPhoto[] = [];
  const documents: PortalDocument[] = [];
  for (const row of rows) {
    const entry = { id: row.id, url: row.file_url, name: row.file_name };
    (isImageAttachment(row) ? photos : documents).push(entry);
  }
  return { photos, documents };
}

/**
 * The engineer's first name, nothing else. Workers are not readable by a customer's
 * login, so this reads the one field with the service role, and only for a job the
 * caller has already been checked against the customer's own access.
 */
export async function getEngineerFirstName(workerId: string | null | undefined): Promise<string | null> {
  if (!workerId) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from('workers').select('full_name').eq('id', workerId).maybeSingle();
    if (error || !data) return null;
    const first = String((data as { full_name: string | null }).full_name ?? '').trim().split(/\s+/)[0];
    return first || null;
  } catch {
    return null;
  }
}

export type PortalJobLoad =
  | { status: 'signed_out' }
  | { status: 'no_link' }
  | { status: 'not_found' }
  | {
      status: 'ok';
      job: PortalJobView;
      tenantName: string;
      timeline: TimelineEvent[];
      photos: PortalPhoto[];
      documents: PortalDocument[];
    };

/**
 * One job for the signed-in customer, with its story, photos and files. A job is only
 * returned when it belongs to a customer this login is linked to.
 */
export async function loadPortalJob(jobId: string): Promise<PortalJobLoad> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'signed_out' };

  const { data: portalRows } = await supabase.from('customer_portal_users').select('customer_id').eq('user_id', user.id);
  const allowed = (portalRows ?? []).map((row: { customer_id: string }) => row.customer_id);
  if (allowed.length === 0) return { status: 'no_link' };

  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      `
      id, reference_number, address, status, scheduled_date, scheduled_time, job_description,
      completion_notes, industry_data, arrived_at, completed_at, created_at, assigned_worker_id,
      customer_id, customers ( tenants ( name ) )
    `,
    )
    .eq('id', jobId)
    .maybeSingle();
  if (error || !job || !job.customer_id || !allowed.includes(job.customer_id as string)) {
    return { status: 'not_found' };
  }

  const [historyResult, photosResult, engineerFirstName] = await Promise.all([
    supabase.rpc('portal_job_history', { p_job_id: jobId }),
    supabase.rpc('portal_job_photos', { p_job_ids: [jobId] }),
    getEngineerFirstName(job.assigned_worker_id as string | null),
  ]);
  if (historyResult.error) console.error('[loadPortalJob] history', historyResult.error);
  if (photosResult.error) console.error('[loadPortalJob] photos', photosResult.error);
  const history = historyResult.data;
  const attachments = photosResult.data;

  const { photos, documents } = splitAttachments(Array.isArray(attachments) ? (attachments as AttachmentRow[]) : []);

  const customer = job.customers as { tenants?: { name?: string | null } | Array<{ name?: string | null }> | null } | null;
  const tenants = customer?.tenants;
  const tenantName = (Array.isArray(tenants) ? tenants[0]?.name : tenants?.name)?.trim() || 'Your provider';

  const industryData =
    job.industry_data && typeof job.industry_data === 'object' && !Array.isArray(job.industry_data)
      ? (job.industry_data as Record<string, unknown>)
      : null;

  return {
    status: 'ok',
    tenantName,
    photos,
    documents,
    timeline: buildTimeline({
      createdAt: (job.created_at as string | null) ?? null,
      arrivedAt: (job.arrived_at as string | null) ?? null,
      history: Array.isArray(history) ? (history as HistoryRow[]) : [],
    }),
    job: {
      id: job.id as string,
      reference: ((job.reference_number as string) || (job.id as string).slice(0, 8)).trim(),
      address: ((job.address as string | null) ?? '').trim(),
      status: (job.status as string | null) ?? 'pending',
      scheduledDate: (job.scheduled_date as string | null) ?? null,
      scheduledTime: (job.scheduled_time as string | null) ?? null,
      description: ((job.job_description as string | null) ?? '').trim(),
      completionNotes: (job.completion_notes as string | null)?.trim() || null,
      reason: incompleteReason(industryData),
      arrivedAt: (job.arrived_at as string | null) ?? null,
      completedAt: (job.completed_at as string | null) ?? null,
      engineerFirstName,
    },
  };
}
