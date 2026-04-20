'use server';

import { createClient } from '@/lib/supabase/server';

/**
 * Admin check: user has role 'admin' in users table OR email is in whitelist.
 * Update adminEmails with your email for platform admin access.
 */
const adminEmails: string[] = [
  // Add your email(s) here for admin access
  // 'your-email@example.com',
  'taylorbk2006@gmail.com'
];

export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: userData } = await supabase
    .from('users')
    .select('role, email')
    .eq('id', user.id)
    .single();

  const email = (userData?.email ?? user.email ?? '').toLowerCase();
  return (
    (userData?.role as string) === 'admin' ||
    adminEmails.some((e) => e.toLowerCase() === email)
  );
}

export async function requireAdmin(): Promise<void> {
  const admin = await isAdmin();
  if (!admin) {
    throw new Error('Unauthorized: Admin access required');
  }
}
