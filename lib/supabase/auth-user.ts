import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * The signed-in auth user, looked up once per request. getUser() is a network
 * call to Supabase Auth, and the layout, sidebar helpers and page each used to
 * make their own. Same strict check as before (not the local-only getClaims()).
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { user, error };
});
