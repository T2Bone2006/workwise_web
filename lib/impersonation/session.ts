import { cookies } from 'next/headers';
import {
  VIEW_AS_COOKIE_OPTIONS,
  VIEW_AS_ORIGIN_COOKIE,
  VIEW_AS_TENANT_COOKIE,
} from '@/lib/impersonation/constants';
import { isAdmin } from '@/lib/utils/admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stored on auth user app_metadata so we can restore if cookies are lost. */
export const VIEW_AS_ORIGIN_META_KEY = 'ww_view_as_origin';

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type ViewAsState = {
  active: boolean;
  tenantId: string | null;
  tenantName: string | null;
  originTenantId: string | null;
};

async function setOriginMetadata(
  userId: string,
  originTenantId: string | null
): Promise<void> {
  const adminClient = createAdminClient();
  await adminClient.auth.admin.updateUserById(userId, {
    app_metadata: { [VIEW_AS_ORIGIN_META_KEY]: originTenantId },
  });
}

/**
 * If a previous view-as left the admin on a client tenant (cookies gone),
 * restore their real tenant_id from app_metadata.
 */
export async function recoverAbandonedViewAsIfNeeded(): Promise<void> {
  try {
    const admin = await isAdmin();
    if (!admin) return;

    const cookieStore = await cookies();
    const activeViewAs = cookieStore.get(VIEW_AS_TENANT_COOKIE)?.value;
    if (activeViewAs && isUuid(activeViewAs)) return;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return;

    const adminClient = createAdminClient();
    const { data: authUser, error } = await adminClient.auth.admin.getUserById(
      user.id
    );
    if (error || !authUser.user) return;

    const origin = authUser.user.app_metadata?.[VIEW_AS_ORIGIN_META_KEY];
    if (typeof origin !== 'string' || !isUuid(origin)) return;

    await adminClient.from('users').update({ tenant_id: origin }).eq('id', user.id);
    await setOriginMetadata(user.id, null);
    await clearViewAsCookies();
  } catch (err) {
    console.error('[recoverAbandonedViewAsIfNeeded]', err);
  }
}

/**
 * Returns view-as state for the current request.
 * Only active when the caller is a platform admin and cookies are set.
 */
export async function getViewAsState(): Promise<ViewAsState> {
  const empty: ViewAsState = {
    active: false,
    tenantId: null,
    tenantName: null,
    originTenantId: null,
  };

  const admin = await isAdmin();
  if (!admin) return empty;

  const cookieStore = await cookies();
  const tenantId = cookieStore.get(VIEW_AS_TENANT_COOKIE)?.value ?? null;
  const originTenantId = cookieStore.get(VIEW_AS_ORIGIN_COOKIE)?.value ?? null;

  if (!tenantId || !isUuid(tenantId)) return empty;

  let tenantName: string | null = null;
  try {
    const adminClient = createAdminClient();
    const { data } = await adminClient
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle();
    tenantName = data?.name?.trim() || 'Unknown tenant';
  } catch {
    tenantName = 'Unknown tenant';
  }

  return {
    active: true,
    tenantId,
    tenantName,
    originTenantId: originTenantId && isUuid(originTenantId) ? originTenantId : null,
  };
}

export async function clearViewAsCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(VIEW_AS_TENANT_COOKIE);
  cookieStore.delete(VIEW_AS_ORIGIN_COOKIE);
}

/**
 * Restores the admin user's real tenant_id if a view-as session is open.
 * Safe to call on logout even when not impersonating.
 */
export async function restoreViewAsTenantIfNeeded(): Promise<void> {
  const cookieStore = await cookies();
  const originTenantId = cookieStore.get(VIEW_AS_ORIGIN_COOKIE)?.value ?? null;
  const viewAsTenantId = cookieStore.get(VIEW_AS_TENANT_COOKIE)?.value ?? null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      await clearViewAsCookies();
      return;
    }

    const adminClient = createAdminClient();
    const { data: authUser } = await adminClient.auth.admin.getUserById(user.id);
    const metaOrigin = authUser.user?.app_metadata?.[VIEW_AS_ORIGIN_META_KEY];

    const origin =
      (originTenantId && isUuid(originTenantId) ? originTenantId : null) ??
      (typeof metaOrigin === 'string' && isUuid(metaOrigin) ? metaOrigin : null);

    if (!viewAsTenantId && !origin) return;

    if (origin) {
      await adminClient.from('users').update({ tenant_id: origin }).eq('id', user.id);
      await setOriginMetadata(user.id, null);
    }
  } catch (err) {
    console.error('[restoreViewAsTenantIfNeeded]', err);
  } finally {
    await clearViewAsCookies();
  }
}

export async function setViewAsCookies(
  tenantId: string,
  originTenantId: string | null
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(VIEW_AS_TENANT_COOKIE, tenantId, VIEW_AS_COOKIE_OPTIONS);
  if (originTenantId) {
    cookieStore.set(VIEW_AS_ORIGIN_COOKIE, originTenantId, VIEW_AS_COOKIE_OPTIONS);
  }
}

/** Persist origin on the auth user so a lost cookie can still be recovered. */
export async function persistViewAsOrigin(
  userId: string,
  originTenantId: string | null
): Promise<void> {
  await setOriginMetadata(userId, originTenantId);
}
