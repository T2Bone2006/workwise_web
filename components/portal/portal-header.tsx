'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

const AUTH_ROUTES = ['/portal/login', '/portal/accept-invite'];

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
    <header className="border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/portal" className="flex items-center gap-2 shrink-0">
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
          <div className="flex items-center gap-3 min-w-0">
            {email ? (
              <span className="hidden truncate text-sm text-muted-foreground sm:inline max-w-[200px] md:max-w-xs">
                {email}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
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
