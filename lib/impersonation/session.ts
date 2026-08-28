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

function readUuidCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  name: string
): string | null {
  const value = cookieStore.get(name)?.value ?? null;
  return value && isUuid(value) ? value : null;
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
    const activeViewAs = readUuidCookie(cookieStore, VIEW_AS_TENANT_COOKIE);
    // Intentional view-as session — leave tenant_id alone.
    if (activeViewAs) return;

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

    const { data: userRow } = await adminClient
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();
    const currentTenantId = (userRow?.tenant_id as string | null) ?? null;

    // Already back on the origin tenant — just clear leftover metadata/cookies.
    if (currentTenantId === origin) {
      await setOriginMetadata(user.id, null);
      await clearViewAsCookies();
      return;
    }

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
  const tenantId = readUuidCookie(cookieStore, VIEW_AS_TENANT_COOKIE);
  const originTenantId = readUuidCookie(cookieStore, VIEW_AS_ORIGIN_COOKIE);

  if (!tenantId) return empty;

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
    originTenantId,
  };
}

/** Clear view-as cookies with the same attributes they were set with (required for delete). */
export async function clearViewAsCookies(): Promise<void> {
  const cookieStore = await cookies();
  const expired = { ...VIEW_AS_COOKIE_OPTIONS, maxAge: 0 };
  cookieStore.set(VIEW_AS_TENANT_COOKIE, '', expired);
  cookieStore.set(VIEW_AS_ORIGIN_COOKIE, '', expired);
}

/**
 * Restores the admin user's real tenant_id if a view-as session is open.
 * Safe to call on logout even when not impersonating.
 */
export async function restoreViewAsTenantIfNeeded(): Promise<void> {
  const cookieStore = await cookies();
  const originFromCookie = readUuidCookie(cookieStore, VIEW_AS_ORIGIN_COOKIE);
  const viewAsTenantId = readUuidCookie(cookieStore, VIEW_AS_TENANT_COOKIE);

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
  const originFromMeta =
    typeof metaOrigin === 'string' && isUuid(metaOrigin) ? metaOrigin : null;

  const origin = originFromCookie ?? originFromMeta;

  if (!viewAsTenantId && !origin) {
    await clearViewAsCookies();
    return;
  }

  if (!origin) {
    throw new Error(
      'Cannot exit view-as: original tenant is missing. Sign out and back in, or contact support.'
    );
  }

  const { error } = await adminClient
    .from('users')
    .update({ tenant_id: origin })
    .eq('id', user.id);
  if (error) {
    console.error('[restoreViewAsTenantIfNeeded] tenant restore failed', error);
    throw new Error(error.message);
  }

  await setOriginMetadata(user.id, null);
  await clearViewAsCookies();
}

export async function setViewAsCookies(
  tenantId: string,
  originTenantId: string | null
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(VIEW_AS_TENANT_COOKIE, tenantId, VIEW_AS_COOKIE_OPTIONS);
  if (originTenantId) {
    cookieStore.set(VIEW_AS_ORIGIN_COOKIE, originTenantId, VIEW_AS_COOKIE_OPTIONS);
  } else {
    cookieStore.set(VIEW_AS_ORIGIN_COOKIE, '', {
      ...VIEW_AS_COOKIE_OPTIONS,
      maxAge: 0,
    });
  }
}

/** Persist origin on the auth user so a lost cookie can still be recovered. */
export async function persistViewAsOrigin(
  userId: string,
  originTenantId: string | null
): Promise<void> {
  await setOriginMetadata(userId, originTenantId);
}
