import { createBrowserClient as createBrowserClientSSR } from '@supabase/ssr';

/**
 * Creates a Supabase client for use in Client Components (browser).
 *
 * Use this in any React component that runs on the client (e.g. components
 * with "use client") when you need to call Supabase (auth, database, storage).
 * The client handles cookies automatically for session persistence.
 *
 * @example
 * ```tsx
 * 'use client';
 * import { createBrowserClient } from '@/lib/supabase/client';
 *
 * const supabase = createBrowserClient();
 * const { data } = await supabase.from('posts').select();
 * ```
 *
 * @returns Supabase client configured for the browser
 * @throws Error if NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY are missing
 */
export function createBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
    );
  }

  return createBrowserClientSSR(supabaseUrl, supabaseAnonKey);
}
