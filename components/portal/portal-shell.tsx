'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { leaveTo } from '@/lib/navigation/leave-to';
import { useTheme } from 'next-themes';
import { Briefcase, ChevronsUpDown, LayoutDashboard, LogOut, Menu, Moon, Sun, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/look/avatar';
import { LookAttribute } from '@/components/look/look-attribute';
import { LookProvider } from '@/components/look/use-look';
import { BreadcrumbNamesProvider, crumbsForPath } from '@/components/layout/page-breadcrumb';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

const AUTH_ROUTES = [
  '/portal/login',
  '/portal/accept-invite',
  '/portal/forgot-password',
  '/portal/reset-password',
];

const emptySubscribe = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

/** The printable job report fills the page on its own, without the sidebar. */
const REPORT_PATH = /^\/portal\/jobs\/[^/]+\/report\/?$/;

const NAV: Array<{ href: string; label: string; icon: LucideIcon; match: (pathname: string) => boolean }> = [
  { href: '/portal', label: 'Overview', icon: LayoutDashboard, match: (p) => p === '/portal' },
  { href: '/portal/attention', label: 'Needs attention', icon: TriangleAlert, match: (p) => p.startsWith('/portal/attention') },
  { href: '/portal/jobs', label: 'Jobs', icon: Briefcase, match: (p) => p.startsWith('/portal/jobs') },
];

function isAuthPath(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function PortalAccountMenu({
  email,
  side = 'top',
  triggerClassName,
  children,
}: {
  email: string | null;
  side?: 'top' | 'bottom' | 'right';
  triggerClassName?: string;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    await leaveTo('/login');
  }

  const triggerClass = cn(
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    triggerClassName,
  );

  if (!hydrated) {
    return (
      <button type="button" aria-label="Your account" className={triggerClass}>
        {children}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Your account" className={triggerClass} disabled={isSigningOut}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={side}
        className="min-w-[220px] rounded-xl border-border bg-popover shadow-lg"
      >
        <DropdownMenuLabel className="font-normal">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="truncate text-sm font-medium text-foreground">{email ?? '—'}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(isDark ? 'light' : 'dark')} className="cursor-pointer">
          {isDark ? <Sun className="mr-2 size-4" /> : <Moon className="mr-2 size-4" />}
          {isDark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void handleSignOut();
          }}
          className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut className="mr-2 size-4" />
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PortalFrame({
  email,
  onNavigate,
  className,
}: {
  email: string | null;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <div className={cn('flex h-full shrink-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-2.5 px-5 pt-5 pb-1">
        <Image src="/workwise_logo.png" alt="" width={32} height={32} className="size-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="text-[15px] leading-tight font-semibold">WorkWise</p>
          <p className="truncate text-[11px] text-muted-foreground">Customer portal</p>
        </div>
      </div>

      <nav className="mt-6 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="Portal">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl px-[15.5px] py-2.5 text-sm font-medium transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                active
                  ? 'bg-(--look-rounds-pill) text-white'
                  : 'text-sidebar-foreground/80 hover:bg-muted hover:text-foreground',
              )}
            >
              <item.icon className="size-[17px] shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-3">
        <PortalAccountMenu
          email={email}
          triggerClassName="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left hover:bg-muted"
        >
          <Avatar name={email?.split('@')[0] ?? '?'} tone="rounds" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{email ?? 'Signed in'}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </PortalAccountMenu>
      </div>
    </div>
  );
}

function PortalTopbar({
  email,
  onMenuClick,
}: {
  email: string | null;
  onMenuClick: () => void;
}) {
  const pathname = usePathname();
  const crumbs = crumbsForPath(pathname);
  const title = crumbs.at(-1)?.label ?? 'Overview';
  const subtitle = crumbs.length > 1 ? crumbs[0]?.label : 'Customer portal';

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 lg:hidden">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open menu"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Menu className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] leading-tight font-semibold">{title}</p>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</p>
      </div>
      <PortalAccountMenu email={email} side="bottom" triggerClassName="rounded-full">
        <Avatar name={email?.split('@')[0] ?? '?'} tone="rounds" />
      </PortalAccountMenu>
    </header>
  );
}

/**
 * Customer portal frame in the dashboard's new look: white sidebar, slim phone
 * bar, warm canvas. Sign-in pages fill the screen on their own.
 */
export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const auth = isAuthPath(pathname);
  const report = REPORT_PATH.test(pathname);
  const [openOnPath, setOpenOnPath] = useState<string | null>(null);
  const mobileOpen = openOnPath === pathname;
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (auth || report) return;
    const supabase = createBrowserClient();
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });
  }, [auth, report]);

  useEffect(() => {
    if (auth || report) return;
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
    };
  }, [auth, report]);

  return (
    <LookProvider value="new">
      <LookAttribute look="new" />
      {auth ? (
        children
      ) : report ? (
        <div data-look="new" className="min-h-screen bg-background text-foreground">
          {children}
        </div>
      ) : (
        <div data-look="new" className="fixed inset-0 flex overflow-clip bg-background text-foreground">
          <aside className="hidden shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
            <PortalFrame email={email} className="w-[216px]" />
          </aside>
          <Sheet open={mobileOpen} onOpenChange={(open) => !open && setOpenOnPath(null)}>
            <SheetContent
              side="left"
              showCloseButton
              className="w-[280px] max-w-[85vw] gap-0 border-r border-sidebar-border bg-sidebar p-0"
            >
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>
              <PortalFrame email={email} onNavigate={() => setOpenOnPath(null)} className="w-full" />
            </SheetContent>
          </Sheet>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <PortalTopbar email={email} onMenuClick={() => setOpenOnPath(pathname)} />
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-5 sm:px-8 sm:py-7">
              <BreadcrumbNamesProvider>
                <div className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col">{children}</div>
              </BreadcrumbNamesProvider>
            </main>
          </div>
        </div>
      )}
    </LookProvider>
  );
}
