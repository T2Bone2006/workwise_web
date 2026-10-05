import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import { sendAccountClosedEmail } from '@/lib/emails/account-closed';
import { disconnectGoCardless } from '@/lib/gocardless/oauth';
import { getStripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';

export type CloseResult = { ok: true; purgeAfter: string } | { ok: false; error: string };

const MANAGED = 'This account is managed by WorkWise. Contact us to close it.';
const ALREADY = 'This account is already closed.';
const BAN_DURATION = '876000h';
const PRO_TIERS = new Set<string>(PRO_TIER_PRODUCTS);
/** Statuses that can still be billed. Cancelled and expired subscriptions are left alone. */
const LIVE_STRIPE_STATUSES = new Set([
  'active',
  'past_due',
  'trialing',
  'incomplete',
  'unpaid',
  'paused',
]);

/**
 * Every customer-file bucket created in supabase/migrations, and the folder
 * those uploads use: `<tenant id>/…`.
 *   expense-receipts/<tenant id>/<expense id>.<ext>
 *   business-assets/<tenant id>/logo-<timestamp>.<ext>
 *   setup-requests/<tenant id>/<request id>/<file>
 */
const TENANT_FILE_BUCKETS = ['expense-receipts', 'business-assets', 'setup-requests'] as const;

type SubRow = { source: string | null; product: string | null };
type LoginRow = { id: string; email: string | null };
type ClosedRow = { id: string; stripe_customer_id: string | null; purge_after: string | null };

function logStep(step: string, tenantId: string, err?: unknown): void {
  if (!err) {
    console.info('[close-account]', step, tenantId);
    return;
  }
  const name = err instanceof Error ? err.name : 'Error';
  console.error('[close-account]', step, tenantId, name);
}

function plus30Days(from: Date): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + 30);
  return next;
}

function formatPurgeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(date);
}

function isSelfServeBlocked(rows: SubRow[]): boolean {
  return rows.some((row) => row.source === 'manual' || (row.product != null && PRO_TIERS.has(row.product)));
}

async function cancelLiveSubscriptions(tenantId: string, customerId: string): Promise<void> {
  const stripe = getStripe();
  const liveIds: string[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const subscription of page.data) {
      if (LIVE_STRIPE_STATUSES.has(subscription.status)) liveIds.push(subscription.id);
    }
    if (!page.has_more || page.data.length === 0) break;
    const last = page.data[page.data.length - 1];
    if (!last || last.id === startingAfter) break;
    startingAfter = last.id;
  }

  let firstError: unknown = null;
  for (const id of liveIds) {
    try {
      await stripe.subscriptions.cancel(
        id,
        { prorate: false, invoice_now: false },
        { idempotencyKey: `close-${tenantId}-${id}` },
      );
    } catch (err) {
      firstError = firstError ?? err;
    }
  }
  if (firstError) throw firstError;
}

async function skipCustomerMessages(admin: SupabaseClient, tenantId: string): Promise<void> {
  const { error: messagesError } = await admin
    .from('messages')
    .update({ status: 'skipped', error: 'plan_ended' })
    .eq('tenant_id', tenantId)
    .eq('status', 'held');
  if (messagesError) {
    const failure = new Error('messages');
    failure.name = 'MessagesError';
    throw failure;
  }

  const { error: textsError } = await admin
    .from('lite_texts')
    .update({ status: 'skipped', skip_reason: 'plan_ended' })
    .eq('tenant_id', tenantId)
    .eq('status', 'scheduled');
  if (textsError) {
    const failure = new Error('lite_texts');
    failure.name = 'LiteTextsError';
    throw failure;
  }
}

/** Ban every login, then sign the current session out. Returns the user ids when the list succeeded. */
async function banLogins(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string[] | null> {
  const { data, error } = await admin.from('users').select('id, email').eq('tenant_id', tenantId);
  if (error) {
    logStep('logins', tenantId, error);
    return null;
  }
  const rows = (data ?? []) as LoginRow[];
  let failed = false;
  for (const row of rows) {
    if (!row.id) continue;
    try {
      const { error: banError } = await admin.auth.admin.updateUserById(row.id, { ban_duration: BAN_DURATION });
      if (banError) {
        failed = true;
        logStep('logins', tenantId, banError);
      }
    } catch (err) {
      failed = true;
      logStep('logins', tenantId, err);
    }
  }

  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      failed = true;
      logStep('logins', tenantId, signOutError);
    }
  } catch (err) {
    failed = true;
    logStep('logins', tenantId, err);
  }

  if (!failed) logStep('logins', tenantId);
  return rows.map((row) => row.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * Steps 3–7. Failures are logged and swallowed: the account is already closed,
 * and the daily cron runs these again before it deletes anything.
 */
async function windDown(
  admin: SupabaseClient,
  tenantId: string,
  customerId: string | null,
): Promise<string[] | null> {
  try {
    if (customerId) await cancelLiveSubscriptions(tenantId, customerId);
    logStep('stripe', tenantId);
  } catch (err) {
    logStep('stripe', tenantId, err);
  }

  try {
    await disconnectGoCardless(admin, { tenantId });
    logStep('gocardless', tenantId);
  } catch (err) {
    logStep('gocardless', tenantId, err);
  }

  try {
    await skipCustomerMessages(admin, tenantId);
    logStep('texts', tenantId);
  } catch (err) {
    logStep('texts', tenantId, err);
  }

  try {
    const { error } = await admin.from('widget_clients').update({ active: false }).eq('tenant_id', tenantId);
    if (error) {
      const failure = new Error('widget');
      failure.name = 'WidgetError';
      throw failure;
    }
    logStep('widget', tenantId);
  } catch (err) {
    logStep('widget', tenantId, err);
  }

  return banLogins(admin, tenantId);
}

async function closingEmail(
  admin: SupabaseClient,
  tenantId: string,
  closedByUserId: string,
  businessName: string,
  purgeAfter: string,
): Promise<void> {
  const { data, error } = await admin
    .from('users')
    .select('id, email')
    .eq('id', closedByUserId)
    .maybeSingle();
  let to = !error && data && typeof (data as LoginRow).email === 'string' ? (data as LoginRow).email : null;
  if (!to) {
    const { data: authData, error: authError } = await admin.auth.admin.getUserById(closedByUserId);
    if (!authError && authData.user?.email) to = authData.user.email;
  }
  if (!to) {
    const failure = new Error('missing_email');
    failure.name = 'MissingEmail';
    throw failure;
  }
  const sent = await sendAccountClosedEmail({
    to,
    businessName,
    purgeDate: formatPurgeDate(purgeAfter),
  });
  if (!sent.ok) {
    const failure = new Error('email');
    failure.name = 'EmailNotSent';
    throw failure;
  }
}

type ListedObject = { name?: string | null; id?: string | null };

function isFolder(entry: ListedObject): boolean {
  return entry.id == null;
}

async function listFiles(admin: SupabaseClient, bucket: string, prefix: string, seen: Set<string>): Promise<string[]> {
  if (seen.has(`${bucket}:${prefix}`)) return [];
  seen.add(`${bucket}:${prefix}`);

  const files: string[] = [];
  const pageSize = 100;
  let offset = 0;
  for (let page = 0; page < 100; page += 1) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: pageSize, offset });
    if (error) {
      const failure = new Error('storage_list');
      failure.name = 'StorageListError';
      throw failure;
    }
    const rows = (data ?? []) as ListedObject[];
    for (const entry of rows) {
      const name = typeof entry.name === 'string' ? entry.name : '';
      if (!name || name === '.emptyFolderPlaceholder') continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (isFolder(entry)) {
        files.push(...(await listFiles(admin, bucket, path, seen)));
      } else {
        files.push(path);
      }
    }
    if (rows.length < pageSize) break;
    offset += rows.length;
  }
  return files;
}

async function deleteTenantFiles(admin: SupabaseClient, tenantId: string): Promise<void> {
  for (const bucket of TENANT_FILE_BUCKETS) {
    const paths = await listFiles(admin, bucket, tenantId, new Set());
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await admin.storage.from(bucket).remove(chunk);
      if (error) {
        const failure = new Error('storage_remove');
        failure.name = 'StorageRemoveError';
        throw failure;
      }
    }
  }
}

function notFoundUser(error: { message?: string; status?: number } | null): boolean {
  if (!error) return false;
  if (error.status === 404) return true;
  return (error.message ?? '').toLowerCase().includes('not found');
}

/**
 * Caller has verified: signed-in admin of tenantId, password correct, business name typed.
 * From the claim onward the business is closed even if a later step fails; the cron retries those.
 */
export async function closeAccount(tenantId: string, closedByUserId: string): Promise<CloseResult> {
  const admin = createAdminClient();

  const [{ data: tenant, error: tenantError }, { data: subs, error: subsError }] = await Promise.all([
    admin.from('tenants').select('id, name, closed_at, stripe_customer_id').eq('id', tenantId).maybeSingle(),
    admin.from('subscriptions').select('source, product').eq('tenant_id', tenantId),
  ]);
  if (tenantError || subsError || !tenant) {
    logStep('eligibility', tenantId, tenantError ?? subsError ?? new Error('missing'));
    return { ok: false, error: MANAGED };
  }

  const row = tenant as {
    id: string;
    name: string | null;
    closed_at: string | null;
    stripe_customer_id: string | null;
  };
  const blocked = isSelfServeBlocked((subs ?? []) as SubRow[]);
  if (!row.stripe_customer_id || blocked) return { ok: false, error: MANAGED };
  if (row.closed_at) return { ok: false, error: ALREADY };
  logStep('eligibility', tenantId);

  const now = new Date();
  const purgeAfter = plus30Days(now).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('tenants')
    .update({ closed_at: now.toISOString(), purge_after: purgeAfter })
    .eq('id', tenantId)
    .is('closed_at', null)
    .select('purge_after');
  if (claimError || !claimed || claimed.length === 0) {
    logStep('claim', tenantId, claimError ?? new Error('already_closed'));
    return { ok: false, error: ALREADY };
  }
  const storedPurge = (claimed[0] as { purge_after?: string | null }).purge_after ?? purgeAfter;
  logStep('claim', tenantId);

  const businessName = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Your business';
  await windDown(admin, tenantId, row.stripe_customer_id);

  try {
    await closingEmail(admin, tenantId, closedByUserId, businessName, storedPurge);
    logStep('email', tenantId);
  } catch (err) {
    logStep('email', tenantId, err);
  }

  return { ok: true, purgeAfter: storedPurge };
}

/** Daily cron body. Max 10 businesses a run. Not-due businesses are wound down (Stripe first) and counted as skipped. */
export async function purgeDueAccounts(now: Date = new Date()): Promise<{ purged: number; failed: number; skipped: number }> {
  const admin = createAdminClient();
  const counts = { purged: 0, failed: 0, skipped: 0 };
  const nowIso = now.toISOString();

  const { data, error } = await admin
    .from('tenants')
    .select('id, stripe_customer_id, purge_after')
    .not('closed_at', 'is', null)
    .order('purge_after', { ascending: true })
    .limit(10);
  if (error) {
    console.error('[close-account] purge_list', error.code ?? 'error');
    return counts;
  }

  const due: ClosedRow[] = ((data ?? []) as ClosedRow[]).filter((row) => typeof row.id === 'string');
  for (const row of due) {
    await windDown(admin, row.id, row.stripe_customer_id);
    const purgeAfter = row.purge_after;
    if (!purgeAfter || purgeAfter > nowIso) {
      counts.skipped += 1;
      continue;
    }

    let userIds: string[] | null = null;
    const { data: logins, error: loginError } = await admin.from('users').select('id').eq('tenant_id', row.id);
    if (loginError) {
      logStep('logins', row.id, loginError);
      counts.failed += 1;
      continue;
    }
    userIds = ((logins ?? []) as { id?: string }[])
      .map((login) => login.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    try {
      await deleteTenantFiles(admin, row.id);
    } catch (err) {
      logStep('storage', row.id, err);
      counts.failed += 1;
      continue;
    }

    const { data: purged, error: purgeError } = await admin.rpc('purge_tenant', { p_tenant_id: row.id });
    if (purgeError) {
      console.error('[close-account] purge_tenant', row.id, purgeError.message);
      counts.failed += 1;
      continue;
    }
    const body = purged as { purged?: boolean; reason?: string } | null;
    if (body && body.purged === false) {
      console.error('[close-account] purge_tenant', row.id, body.reason ?? 'refused');
      counts.failed += 1;
      continue;
    }

    for (const id of userIds) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(id);
      if (deleteError && !notFoundUser(deleteError)) {
        logStep('delete_login', row.id, deleteError);
      }
    }
    counts.purged += 1;
  }

  return counts;
}
