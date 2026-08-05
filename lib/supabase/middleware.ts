import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export type UpdateSessionResult = {
  response: NextResponse;
  user: { id: string } | null;
};

/**
 * Refreshes the Supabase auth session and returns a response with updated cookies
 * plus the current user (if any) for redirect logic.
 *
 * Call this from your Next.js middleware so that expired tokens are refreshed and
 * cookies are updated on both the request (for Server Components) and the response
 * (for the browser). Required for SSR auth to work correctly.
 *
 * @example
 * ```ts
 * // middleware.ts at project root
 * import { updateSession } from '@/lib/supabase/middleware';
 *
 * export async function middleware(request: NextRequest) {
 *   const { response, user } = await updateSession(request);
 *   // Apply redirect logic based on user, then return response (or redirect with cookies).
 *   return response;
 * }
 * ```
 *
 * @param request - The incoming Next.js request
 * @returns Object with NextResponse (with updated Set-Cookie when session was refreshed) and user
 */
export async function updateSession(request: NextRequest): Promise<UpdateSessionResult> {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      '[Supabase middleware] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
    return { response, user: null };
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  let user: { id: string } | null = null;
  try {
    // getClaims() verifies the JWT locally against a cached JWKS (this project
    // uses asymmetric signing keys) instead of getUser()'s per-request round
    // trip to the Auth server, while still refreshing an expiring session via
    // the same cookie adapter.
    const { data } = await supabase.auth.getClaims();
    if (data?.claims.sub) {
      user = { id: data.claims.sub };
    }
  } catch {
    // Session refresh can fail (e.g. invalid token). Continue with the response
    // so the app can handle unauthenticated state.
  }

  return { response, user };
}
