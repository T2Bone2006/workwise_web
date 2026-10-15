'use server';

import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';

/**
 * Admin check: user email is in whitelist.
 * Update adminEmails with your email for platform admin access.
 */
const adminEmails: string[] = [
  // Add your email(s) here for admin access
  // 'your-email@example.com',
  'taylorbk2006@gmail.com'
];

export async function isAdmin(): Promise<boolean> {
  const { user } = await getAuthUser();
  if (!user) return false;

  const supabase = await createClient();

  const { data: userData } = await supabase
    .from('users')
    .select('email')
    .eq('id', user.id)
    .single();

  const email = (userData?.email ?? user.email ?? '').toLowerCase();
  return adminEmails.some((e) => e.toLowerCase() === email);
}

export async function requireAdmin(): Promise<void> {
  const admin = await isAdmin();
  if (!admin) {
    throw new Error('Unauthorized: Admin access required');
  }
}
