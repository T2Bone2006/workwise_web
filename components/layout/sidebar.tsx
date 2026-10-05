'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, Brain, Eye } from 'lucide-react';
import type { TenantFeatures } from '@/lib/data/tenant-features';
import { AddLiteCard } from './add-lite-card';
import { buildNavSections, isNavItemActive, SIDEBAR_STORAGE_KEY, type NavItem } from './nav-sections';
import { LookSidebar } from './look-sidebar';
import { useLook } from '@/components/look/use-look';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  isAdmin?: boolean;
  /** When > 0, shows a dot next to Network (or on the icon when sidebar is collapsed). */
  networkBadge?: number;
  /** When > 0, shows a dot next to Messages, the same way as Network. */
  messagesBadge?: number;
  features: TenantFeatures;
  /** New look only: the business name and signed-in user shown at the top and bottom of the sidebar. */
  tenantName?: string;
  userEmail?: string;
  viewAsActive?: boolean;
  /** Rounds-only self-serve admins: quiet Add Lite card above Settings. */
  showAddLite?: boolean;
  /** Yearly Rounds plans show +£240 a year on that card. */
  addLiteYearly?: boolean;
  /** Self-serve admins: green referral row at the bottom of the new-look sidebar. */
  showReferral?: boolean;
}

function ClassicSidebar({
  mobileOpen,
  onMobileClose,
  isAdmin = false,
  networkBadge,
  messagesBadge,
  features,
  showAddLite = false,
  addLiteYearly = false,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  const navSections = buildNavSections(features)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.show),
    }))
    .filter((section) => section.items.length > 0);
  const settingsSection = navSections.find((section) =>
    section.items.some((item) => item.href === '/settings')
  );
  const mainSections = navSections.filter((section) => section !== settingsSection);
  const navHrefs = navSections.flatMap((section) => section.items.map((item) => item.href));
  // Lite-only: /dashboard immediately redirects back to /lite. Prefetching that
  // link follows the redirect and reloads /lite forever.
  const liteOnly = features.lite && !features.rounds && !features.pro;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) setCollapsed(stored === 'true');
  }, [mounted]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (mounted) localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
  };

  const linkContent = (item: NavItem, isMobile = false) => {
    const badgeCount =
      item.href === '/network'
        ? networkBadge
        : item.href === '/messages'
          ? messagesBadge
          : undefined;
    const showDot = badgeCount != null && badgeCount > 0;
    const labelVisible = !collapsed || isMobile;
    const dotOnIcon = showDot && !labelVisible;
    const dotAfterLabel = showDot && labelVisible;
    const dotStyleClass =
      'size-[8px] animate-pulse rounded-full [background-image:radial-gradient(circle_at_center,#a78bfa,#6366f1)] [box-shadow:0_0_6px_1px_rgba(139,92,246,0.7)]';

    return (
      <Link
        href={item.href}
        prefetch={item.href === '/dashboard' && liteOnly ? false : undefined}
        onClick={isMobile ? onMobileClose : undefined}
        aria-current={isNavItemActive(pathname, item.href, navHrefs) ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
          'hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground hover:translate-x-0.5 hover:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          isNavItemActive(pathname, item.href, navHrefs)
            ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
            : 'text-sidebar-foreground/90'
        )}
      >
        {dotOnIcon ? (
          <span className="relative inline-flex shrink-0">
            <item.icon className="size-5" aria-hidden />
            <span
              className={cn('absolute right-0 top-0', dotStyleClass)}
              aria-hidden
            />
          </span>
        ) : (
          <item.icon className="size-5 shrink-0" aria-hidden />
        )}
        {labelVisible && (
          <span className="inline-flex min-w-0 items-center">
            <span>{item.label}</span>
            {dotAfterLabel && (
              <span className={cn('ml-2 shrink-0', dotStyleClass)} aria-hidden />
            )}
          </span>
        )}
      </Link>
    );
  };

  const sidebarContent = (isMobile: boolean) => (
    <>
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-sidebar-border',
          !isMobile && collapsed ? 'justify-center px-0' : 'gap-3 px-3'
        )}
      >
        <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-accent/20">
          <Image
            src="/workwise_logo.png"
            alt="WorkWise"
            width={28}
            height={28}
            className="object-contain"
          />
        </div>
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap text-base font-semibold text-sidebar-foreground',
            'transition-[max-width,opacity] duration-200 ease-out',
            !collapsed || isMobile ? 'max-w-[140px] opacity-100' : 'max-w-0 opacity-0'
          )}
        >
          WorkWise
        </span>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col p-3" aria-label="Main navigation">
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {mainSections.map((section, index) => (
          <div key={section.title ?? `section-${index}`} className={cn(section.title && 'mt-2')}>
            {section.title && (!collapsed || isMobile) && (
              <h2 className="mb-1 px-3 text-xs font-semibold uppercase text-muted-foreground">
                {section.title}
              </h2>
            )}
            {section.items.map((item) => (
              <div key={item.href}>{linkContent(item, isMobile)}</div>
            ))}
          </div>
        ))}
        {isAdmin && (
          <>
            <Separator className="my-4" />
            <div className="px-3 py-2">
              <h2 className="mb-2 px-4 text-xs font-semibold text-muted-foreground uppercase">
                Admin
              </h2>
              <div className="space-y-1">
                <Link
                  href="/admin/view-as"
                  onClick={isMobile ? onMobileClose : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                    'hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground hover:translate-x-0.5 hover:shadow-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    pathname === '/admin/view-as'
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                      : 'text-sidebar-foreground/90'
                  )}
                >
                  <Eye className="size-5 shrink-0" aria-hidden />
                  {(!collapsed || isMobile) && (
                    <>
                      <span>View as tenant</span>
                      <Badge variant="secondary" className="ml-auto text-xs">
                        Admin
                      </Badge>
                    </>
                  )}
                </Link>
                <Link
                  href="/admin/ai-analytics"
                  onClick={isMobile ? onMobileClose : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                    'hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground hover:translate-x-0.5 hover:shadow-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    pathname === '/admin/ai-analytics'
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                      : 'text-sidebar-foreground/90'
                  )}
                >
                  <Brain className="size-5 shrink-0" aria-hidden />
                  {(!collapsed || isMobile) && (
                    <>
                      <span>AI Analytics</span>
                      <Badge variant="secondary" className="ml-auto text-xs">
                        Admin
                      </Badge>
                    </>
                  )}
                </Link>
              </div>
            </div>
          </>
        )}
        </div>
        {(showAddLite || settingsSection) && (
          <div className="mt-auto shrink-0 space-y-2 pt-2">
            {showAddLite ? (
              <div className={cn('px-2', collapsed && !isMobile && 'px-1')}>
                <AddLiteCard collapsed={Boolean(collapsed && !isMobile)} yearly={addLiteYearly} />
              </div>
            ) : null}
            {settingsSection?.items.map((item) => (
              <div key={item.href}>{linkContent(item, isMobile)}</div>
            ))}
          </div>
        )}
      </nav>
      {!isMobile && (
        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            className="size-9 rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft
              className={cn('size-5 transition-transform duration-200', collapsed && 'rotate-180')}
            />
          </Button>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <aside
        className={cn(
          'hidden md:flex md:h-full md:min-h-0 md:flex-col md:shrink-0 md:relative md:overflow-hidden md:rounded-r-xl',
          'transition-[width] duration-[250ms] ease-[cubic-bezier(0.32,0.72,0,1)]'
        )}
        style={{
          width: collapsed ? 72 : 192,
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(var(--blur-glass))',
          WebkitBackdropFilter: 'blur(var(--blur-glass))',
          boxShadow: 'var(--shadow-glass-value)',
        }}
      >
        <div
          className="absolute inset-0 rounded-r-xl border border-l-0 border-sidebar-border pointer-events-none"
          aria-hidden
        />
        <div className="relative z-10 flex flex-1 flex-col min-h-0">
          {sidebarContent(false)}
        </div>
      </aside>

      {/* Mobile: Sheet overlay */}
      <Sheet open={mobileOpen} onOpenChange={(open) => !open && onMobileClose()}>
        <SheetContent
          side="left"
          showCloseButton={true}
          className="w-[280px] max-w-[85vw] border-r border-sidebar-border bg-card p-0 dark:bg-card"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(var(--blur-glass-strong))',
            WebkitBackdropFilter: 'blur(var(--blur-glass-strong))',
          }}
        >
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <div className="flex flex-col h-full pt-2">{sidebarContent(true)}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Classic for Pro logins, the new look for Rounds and Lite (Phase 7b). */
export function Sidebar(props: SidebarProps) {
  const look = useLook();
  if (look === 'new') return <LookSidebar {...props} />;
  return <ClassicSidebar {...props} />;
}
