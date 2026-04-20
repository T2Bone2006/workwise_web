'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export type AuthResult = { success: boolean; error?: string };

/**
 * Server Action: sign in with email and password.
 * Uses Supabase auth and revalidates/redirects on success.
 */
export async function login(
  _prev: unknown,
  formData: FormData
): Promise<AuthResult> {
  const email = formData.get('email') as string | null;
  const password = formData.get('password') as string | null;

  if (!email?.trim() || !password) {
    return { success: false, error: 'Email and password are required.' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      // Use a single message for invalid email or password so we don't leak which was wrong
      const message =
        error.message?.toLowerCase().includes('invalid') ||
        error.message?.toLowerCase().includes('credentials')
          ? 'Invalid email or password'
          : error.message;
      const result: AuthResult = { success: false, error: message };
      console.log('[login Server Action] Auth failed, returning:', result);
      return result;
    }

    revalidatePath('/', 'layout');
    redirect('/dashboard');
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) {
      // redirect() throws; don't treat it as an error
      throw err;
    }
    const message =
      err instanceof Error ? err.message : 'Something went wrong. Please try again.';
    return { success: false, error: message };
  }
}

/**
 * Server Action: sign out the current user.
 * Uses Supabase auth and revalidates/redirects to login.
 * Can be used as a form action (e.g. <form action={logout}>).
 */
export async function logout(
  _prev?: unknown,
  _formData?: FormData
): Promise<AuthResult> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
    revalidatePath('/', 'layout');
    redirect('/login');
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : 'Failed to sign out.';
    return { success: false, error: message };
  }
}
