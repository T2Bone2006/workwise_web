import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Find an Auth user id by email via the admin API (paginated).
 * Returns null if not found or listUsers fails.
 */
export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string
): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('[findAuthUserByEmail] listUsers:', error);
      return null;
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

export async function findAuthUserIdByEmail(
  admin: SupabaseClient,
  email: string
): Promise<string | null> {
  const user = await findAuthUserByEmail(admin, email);
  return user?.id ?? null;
}

export function isAlreadyRegisteredAuthError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  const msg = (error?.message ?? '').toLowerCase();
  const code = (error?.code ?? '').toLowerCase();
  return (
    code === 'email_exists' ||
    msg.includes('already been registered') ||
    msg.includes('already registered') ||
    msg.includes('user already exists') ||
    msg.includes('email address is already')
  );
}
