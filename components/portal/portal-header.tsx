'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

const AUTH_ROUTES = [
  '/portal/login',
  '/portal/accept-invite',
  '/portal/forgot-password',
  '/portal/reset-password',
];

export function PortalHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  useEffect(() => {
    if (isAuthRoute) return;

    const supabase = createBrowserClient();
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });
  }, [isAuthRoute, pathname]);

  async function handleSignOut() {
    setIsSigningOut(true);
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push('/portal/login');
    router.refresh();
  }

  return (
    <header className="border-b border-sky-200/70 bg-gradient-to-r from-sky-50/90 via-background/95 to-cyan-50/80 backdrop-blur supports-[backdrop-filter]:bg-background/80 dark:border-sky-900/40 dark:from-sky-950/40 dark:via-background/95 dark:to-cyan-950/30">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/portal" className="flex shrink-0 items-center gap-2">
          <Image
            src="/workwise_logo.png"
            alt="WorkWise"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
            priority
          />
          <span className="text-sm font-semibold tracking-wide text-foreground sm:text-base">
            WorkWise Portal
          </span>
        </Link>

        {!isAuthRoute && (
          <div className="flex min-w-0 items-center gap-3">
            {email ? (
              <span className="hidden max-w-[200px] truncate text-sm text-muted-foreground sm:inline md:max-w-xs">
                {email}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 border-sky-300/60 bg-white/60 backdrop-blur-sm dark:border-sky-800/50 dark:bg-background/50"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              <LogOut className="size-4" aria-hidden />
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
