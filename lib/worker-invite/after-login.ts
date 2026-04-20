import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Run after a successful worker `signInWithPassword` in the mobile app.
 * Links `auth.users` to the pre-created `workers` row (sets `user_id`, `invite_status = active`).
 * Equivalent to updating `workers` where `email` matches and `user_id` is null, but uses the
 * `link_pending_worker_profile` RPC so RLS does not block the update.
 */
export async function linkPendingWorkerAfterLogin(supabase: SupabaseClient) {
  const { error } = await supabase.rpc('link_pending_worker_profile');
  return { error: error ?? null };
}
