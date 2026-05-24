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
  const isAcceptInvitePage =
    pathname === '/accept-invite' || pathname.startsWith('/accept-invite');
  const isDashboard = pathname === '/dashboard' || pathname.startsWith('/dashboard');
  const isPortalPage = pathname === '/portal' || pathname.startsWith('/portal');
  const isPortalAcceptInvite = pathname.startsWith('/portal/accept-invite');
  const isPortalLogin = pathname === '/portal/login';

  if (!isAuthenticated && isDashboard) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
    copyCookiesToResponse(response, redirectResponse);
    return redirectResponse;
  }

  if (!isAuthenticated && isPortalPage && !isPortalAcceptInvite && !isPortalLogin) {
    const redirectResponse = NextResponse.redirect(new URL('/portal/login', request.url));
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

      const isCustomerPortal = profile?.role === 'customer_portal';

      if (isCustomerPortal && !isPortalPage && !isPortalAcceptInvite) {
        const redirectResponse = NextResponse.redirect(new URL('/portal', request.url));
        copyCookiesToResponse(response, redirectResponse);
        return redirectResponse;
      }

      if (isAuthenticated && isLoginPage) {
        const destination = isCustomerPortal ? '/portal' : '/dashboard';
        const redirectResponse = NextResponse.redirect(new URL(destination, request.url));
        copyCookiesToResponse(response, redirectResponse);
        return redirectResponse;
      }

      if (isAuthenticated && isPortalLogin && isCustomerPortal) {
        const redirectResponse = NextResponse.redirect(new URL('/portal', request.url));
        copyCookiesToResponse(response, redirectResponse);
        return redirectResponse;
      }
    }
  } else if (isAuthenticated && isLoginPage) {
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
