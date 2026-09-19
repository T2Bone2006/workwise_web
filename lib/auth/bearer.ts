import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)/i);
  return match?.[1] ?? null;
}

/**
 * Builds a supabase-js client that acts AS the caller: anon key + the caller's
 * JWT in the Authorization header, so RLS applies exactly as in the app.
 * Returns null when the header is missing or the token does not resolve to a user.
 */
export async function createClientFromBearer(
  request: Request,
): Promise<{ supabase: SupabaseClient; userId: string } | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  }

  // Validate the JWT without installing a session. `accessToken` on the data
  // client disables `auth.*`, so this check uses a separate client.
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);
  if (error || !user?.id) return null;

  // `accessToken` is how supabase-js attaches the caller's JWT on every
  // PostgREST request. Setting only `global.headers.Authorization` is
  // overwritten with the anon key when there is no session.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    accessToken: async () => token,
  });

  return { supabase, userId: user.id };
}

/** `users.tenant_id`, else `workers.primary_tenant_id`. */
export async function resolveTenantForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', userId)
    .maybeSingle();
  if (typeof userRow?.tenant_id === 'string' && userRow.tenant_id) {
    return userRow.tenant_id;
  }

  const { data: workerRow } = await supabase
    .from('workers')
    .select('primary_tenant_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (typeof workerRow?.primary_tenant_id === 'string' && workerRow.primary_tenant_id) {
    return workerRow.primary_tenant_id;
  }

  return null;
}
