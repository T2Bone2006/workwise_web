'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { WORKER_WEB_LOGIN_ERROR } from '@/lib/auth/worker-web-access';
import { buildPasswordResetEmail } from '@/lib/emails/password-reset';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { restoreViewAsTenantIfNeeded, recoverAbandonedViewAsIfNeeded } from '@/lib/impersonation/session';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * `attemptedAt` makes each failure distinguishable to `useActionState`
 * consumers. Without it, two identical failures produce equal state values and
 * a `useEffect` watching them won't re-run, so the second wrong password shows
 * no error at all.
 */
export type AuthResult = {
  success: boolean;
  error?: string;
  attemptedAt?: number;
};

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
    return {
      success: false,
      error: 'Email and password are required.',
      attemptedAt: Date.now(),
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

      if (error) {
      return {
        success: false,
        error: 'Invalid email or password',
        attemptedAt: Date.now(),
      };
    }

    // Recover if a previous view-as session left tenant_id swapped
    await recoverAbandonedViewAsIfNeeded();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle<{ role: string | null }>();

      if (profile?.role === 'worker') {
        await supabase.auth.signOut();
        return {
          success: false,
          error: WORKER_WEB_LOGIN_ERROR,
          attemptedAt: Date.now(),
        };
      }

      revalidatePath('/', 'layout');

      if (profile?.role === 'customer_portal') {
        redirect('/portal');
      }
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
    return { success: false, error: message, attemptedAt: Date.now() };
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
    // If a prior view-as left cookies / tenant_id swapped, restore before sign-out.
    // (When view-as is active, Topbar exits via API first because server actions are blocked.)
    await restoreViewAsTenantIfNeeded();
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

export async function requestAdminPasswordReset(email: string) {
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm) {
    return { success: true as const };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error('[requestAdminPasswordReset] admin client:', e);
    return { success: false as const, error: 'Server configuration error' };
  }

  const { data: userRecord, error: userError } = await admin
    .from('users')
    .select('id, role, full_name')
    .eq('email', emailNorm)
    .maybeSingle();

  if (userError) {
    console.error('[requestAdminPasswordReset] lookup user:', userError);
    return { success: false as const, error: 'Failed to process password reset' };
  }

  if (!userRecord || userRecord.role === 'customer_portal' || userRecord.role === 'worker') {
    return { success: true as const };
  }

  const userId = userRecord.id;
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error: deleteOldTokensError } = await admin
    .from('password_resets')
    .delete()
    .eq('user_id', userId)
    .is('used_at', null);

  if (deleteOldTokensError) {
    console.error('[requestAdminPasswordReset] delete existing tokens:', deleteOldTokensError);
    return { success: false as const, error: 'Failed to process password reset' };
  }

  const { error: insertTokenError } = await admin.from('password_resets').insert({
    token,
    user_id: userId,
    email: emailNorm,
    expires_at: expiresAt,
  });

  if (insertTokenError) {
    console.error('[requestAdminPasswordReset] insert token:', insertTokenError);
    return { success: false as const, error: 'Failed to process password reset' };
  }

  const resetUrl = `https://app.joinworkwise.com/admin-reset-password?token=${token}`;
  const { subject, html } = buildPasswordResetEmail({
    recipientName: userRecord.full_name ?? 'there',
    resetUrl,
    isWorker: false,
  });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: emailNorm,
      subject,
      html,
    });
  } catch (e) {
    console.error('[requestAdminPasswordReset] resend:', e);
    return { success: false as const, error: 'Failed to send reset email' };
  }

  return { success: true as const };
}

export async function requestWorkerPasswordReset(workerId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false as const, error: 'Not authenticated' };
  }

  const { data: requester, error: requesterError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle();

  if (requesterError || !requester?.tenant_id) {
    return { success: false as const, error: 'No tenant found' };
  }

  const { data: worker, error: workerError } = await supabase
    .from('workers')
    .select('id, primary_tenant_id, full_name, email, user_id')
    .eq('id', workerId)
    .maybeSingle();

  if (workerError || !worker || worker.primary_tenant_id !== requester.tenant_id) {
    return { success: false as const, error: 'Worker not found or access denied' };
  }

  if (!worker.user_id) {
    return {
      success: false as const,
      error: 'This worker has not set up their account yet',
    };
  }

  if (!worker.email) {
    return { success: false as const, error: 'Worker has no email address' };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error('[requestWorkerPasswordReset] admin client:', e);
    return { success: false as const, error: 'Server configuration error' };
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error: deleteOldTokensError } = await admin
    .from('password_resets')
    .delete()
    .eq('user_id', worker.user_id)
    .is('used_at', null);

  if (deleteOldTokensError) {
    console.error('[requestWorkerPasswordReset] delete existing tokens:', deleteOldTokensError);
    return { success: false as const, error: 'Failed to send password reset email' };
  }

  const { error: insertTokenError } = await admin.from('password_resets').insert({
    token,
    user_id: worker.user_id,
    email: worker.email,
    expires_at: expiresAt,
  });

  if (insertTokenError) {
    console.error('[requestWorkerPasswordReset] insert token:', insertTokenError);
    return { success: false as const, error: 'Failed to send password reset email' };
  }

  const resetUrl = `https://app.joinworkwise.com/reset-password?token=${token}`;
  const { subject, html } = buildPasswordResetEmail({
    recipientName: worker.full_name,
    resetUrl,
    isWorker: true,
  });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: worker.email,
      subject,
      html,
    });
  } catch (e) {
    console.error('[requestWorkerPasswordReset] resend:', e);
    return { success: false as const, error: 'Failed to send password reset email' };
  }

  return { success: true as const };
}
