import { updateSession } from '@/lib/supabase/middleware';
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
  const { response, user } = await updateSession(request);

  const pathname = request.nextUrl.pathname;

  // Allow all /api routes without redirect
  if (pathname.startsWith('/api')) {
    return response;
  }

  const isAuthenticated = !!user;
  const isLoginPage = pathname === '/login' || pathname.startsWith('/login');
  const isDashboard = pathname === '/dashboard' || pathname.startsWith('/dashboard');

  // Not authenticated + trying to access /dashboard → redirect to /login
  if (!isAuthenticated && isDashboard) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
    copyCookiesToResponse(response, redirectResponse);
    return redirectResponse;
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
