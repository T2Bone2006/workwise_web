import { updateSession } from '@/lib/supabase/middleware';
import {
  WORKER_WEB_LOGIN_ERROR_PARAM,
} from '@/lib/auth/worker-web-access';
import { VIEW_AS_TENANT_COOKIE } from '@/lib/impersonation/constants';
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

const UNPROTECTED_PATHS = [
  '/auth/callback',
  '/forgot-password',
  '/admin-reset-password',
  '/reset-password',
] as const;

/** Paths workers may visit on the web (invite / password setup). */
const WORKER_ALLOWED_PATHS = [
  '/accept-invite',
  '/reset-password',
  '/login',
] as const;

function isUnprotectedPath(pathname: string): boolean {
  return UNPROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

function isWorkerAllowedPath(pathname: string): boolean {
  return WORKER_ALLOWED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Allow all /api routes without redirect (view-as start/stop handle their own auth)
  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Read-only while platform admin is viewing as a client: block Server Actions
  const viewAsTenant = request.cookies.get(VIEW_AS_TENANT_COOKIE)?.value;
  const isServerAction =
    request.method === 'POST' &&
    (request.headers.has('next-action') || request.headers.has('Next-Action'));
  if (viewAsTenant && isServerAction) {
    return NextResponse.json(
      {
        error:
          'Read-only while viewing as a client. Exit view-as mode to make changes.',
      },
      { status: 403 }
    );
  }

  if (isUnprotectedPath(pathname)) {
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  const isAuthenticated = !!user;
  const isLoginPage = pathname === '/login' || pathname.startsWith('/login');
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
      const isWorker = profile?.role === 'worker';

      // Workers are mobile-only: clear the web session and send them to login
      // unless they are finishing invite / password reset.
      if (isWorker) {
        if (!isWorkerAllowedPath(pathname)) {
          await supabase.auth.signOut();
          const loginUrl = new URL('/login', request.url);
          loginUrl.searchParams.set('error', WORKER_WEB_LOGIN_ERROR_PARAM);
          const redirectResponse = NextResponse.redirect(loginUrl);
          copyCookiesToResponse(response, redirectResponse);
          return redirectResponse;
        }

        // Allow invite / reset / login pages, but never leave a worker web session on /login.
        if (isLoginPage) {
          await supabase.auth.signOut();
          return response;
        }

        return response;
      }

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
