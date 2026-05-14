import { updateSession } from '@/lib/supabase/middleware';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Copies all cookies from the session response to the redirect response
 * so the client receives refreshed session cookies when we redirect.
 */
function copyCookiesToResponse(
  source: NextResponse,
  target: NextResponse
): void {
  const cookies = source.cookies.getAll();
  cookies.forEach((cookie) => {
    target.cookies.set(cookie.name, cookie.value, cookie);
  });
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow all /api routes without redirect
  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  const isAuthenticated = !!user;
  const isLoginPage = pathname === '/login' || pathname.startsWith('/login');
  const isDashboard = pathname === '/dashboard' || pathname.startsWith('/dashboard');
  const isPortalPage = pathname === '/portal' || pathname.startsWith('/portal');

  // Not authenticated + trying to access /dashboard → redirect to /login
  if (!isAuthenticated && (isDashboard || isPortalPage)) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
    copyCookiesToResponse(response, redirectResponse);
    return redirectResponse;
  }

  if (isAuthenticated && user) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return response.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      });

      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle<{ role: string | null }>();

      if (profile?.role === 'customer_portal' && !isPortalPage) {
        const redirectResponse = NextResponse.redirect(new URL('/portal', request.url));
        copyCookiesToResponse(response, redirectResponse);
        return redirectResponse;
      }
    }
  }

  // Authenticated + trying to access /login → redirect to /dashboard
  if (isAuthenticated && isLoginPage) {
    const redirectResponse = NextResponse.redirect(new URL('/dashboard', request.url));
    copyCookiesToResponse(response, redirectResponse);
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico and common image formats
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
