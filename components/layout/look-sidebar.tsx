'use client';

import { useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brain, ChevronLeft, ChevronsUpDown, Eye } from 'lucide-react';
import { Avatar } from '@/components/look/avatar';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AddLiteCard } from './add-lite-card';
import { ReferralCard } from './referral-card';
import { LookUserMenu } from './look-user-menu';
import { buildNavSections, isNavItemActive, SIDEBAR_STORAGE_KEY, type NavItem } from './nav-sections';
import type { SidebarProps } from './sidebar';

type Accent = 'rounds' | 'lite';

const COLLAPSE_EVENT = 'workwise-sidebar-collapsed-change';

function subscribeCollapsed(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(COLLAPSE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(COLLAPSE_EVENT, onChange);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Labels fade instead of popping, and the text itself never reflows (the rail clips a fixed-width inner). */
const FADE = (expanded: boolean) =>
  cn('transition-opacity duration-150', expanded ? 'opacity-100 delay-100' : 'pointer-events-none opacity-0');

const PILL: Record<Accent, string> = {
  rounds: 'bg-(--look-rounds-pill) text-white',
  lite: 'bg-(--look-lite-pill) text-white',
};

/**
 * The new-look sidebar (Phase 7b step 3), from DashboardShell in
 * workwise_site/components/renderings/devices.tsx: 216 px, white, a solid pill
 * on the page you're on (Rounds blue, Lite purple), Settings and your account
 * at the bottom. Same links, order and collapse preference as the classic one.
 */
export function LookSidebar({
  mobileOpen,
  onMobileClose,
  isAdmin = false,
  messagesBadge,
  features,
  tenantName,
  userEmail,
  viewAsActive = false,
  showAddLite = false,
  addLiteYearly = false,
  showReferral = false,
}: SidebarProps) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);

  const toggleCollapsed = () => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!collapsed));
    } catch {
      // private window: the toggle just won't be remembered
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  };

  const sections = buildNavSections(features)
    .map((section) => ({ ...section, items: section.items.filter((item) => item.show) }))
    .filter((section) => section.items.length > 0);
  const settingsSection = sections.find((section) => section.items.some((item) => item.href === '/settings'));
  const mainSections = sections.filter((section) => section !== settingsSection);
  const navHrefs = sections.flatMap((section) => section.items.map((item) => item.href));
  const liteOnly = features.lite && !features.rounds && !features.pro;
  // Dashboard and Settings take the colour of the product the login mostly lives in.
  const homeAccent: Accent = liteOnly ? 'lite' : 'rounds';

  const renderLink = (item: NavItem, accent: Accent, isMobile: boolean) => {
    const active = isNavItemActive(pathname, item.href, navHrefs);
    const expanded = !collapsed || isMobile;
    const unread = item.href === '/messages' && messagesBadge != null && messagesBadge > 0 ? messagesBadge : 0;
    const link = (
      <Link
        href={item.href}
        prefetch={item.href === '/dashboard' && liteOnly ? false : undefined}
        onClick={isMobile ? onMobileClose : undefined}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        className={cn(
          // The icon sits at the same x in both widths (centred in the 72 px rail), so it never moves.
          // The row stays the full 216 px width, so a collapsed pill is clipped by the rail: rounded on the left, flush on the right.
          'relative flex items-center gap-3 rounded-xl px-[15.5px] py-2.5 text-sm font-medium transition-colors',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          active ? PILL[accent] : 'text-sidebar-foreground/80 hover:bg-muted hover:text-foreground',
        )}
      >
        <item.icon className="size-[17px] shrink-0" aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate whitespace-nowrap', FADE(expanded))} aria-hidden={!expanded}>
          {item.label}
        </span>
        {unread > 0 ? (
          <>
            <span
              className={cn(
                'flex h-5 min-w-5 items-center justify-center rounded-full bg-(--tone-rose-solid) px-1.5 text-[11px] font-semibold text-white',
                FADE(expanded),
              )}
              aria-label={`${unread} to review`}
            >
              {unread}
            </span>
            <span
              className={cn(
                'absolute top-1.5 right-2.5 size-2 rounded-full bg-(--tone-rose-solid) transition-opacity duration-150',
                expanded ? 'opacity-0' : 'opacity-100 delay-150',
              )}
              aria-hidden
            />
          </>
        ) : null}
      </Link>
    );
    // Always wrapped, so the link is never remounted while the rail animates; the tip only shows when collapsed.
    // The link is 192 px inside a 72 px rail (216 px column, 12 px nav padding each side). Pull the tip back to just outside the rail.
    return (
      <Tooltip open={expanded ? false : undefined}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={-126} avoidCollisions={false}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  };

  const content = (isMobile: boolean) => {
    const expanded = !collapsed || isMobile;
    return (
      <div className={cn('flex h-full flex-col', isMobile ? 'w-full' : 'w-[216px] shrink-0')}>
        <div className="flex shrink-0 items-center gap-2.5 px-5 pt-5 pb-1">
          <Image src="/workwise_logo.png" alt="" width={32} height={32} className="size-8 shrink-0 object-contain" />
          <div className={cn('min-w-0', FADE(expanded))} aria-hidden={!expanded}>
            <p className="text-[15px] leading-tight font-semibold">WorkWise</p>
            {tenantName ? (
              <p className="max-w-[140px] truncate text-[11px] text-muted-foreground" title={tenantName}>
                {tenantName}
              </p>
            ) : null}
          </div>
        </div>

        <nav className="mt-6 flex min-h-0 flex-1 flex-col px-3" aria-label="Main navigation">
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden">
            {mainSections.map((section, index) => {
              const accent: Accent = section.product === 'lite' ? 'lite' : 'rounds';
              return (
                <div key={section.title ?? `section-${index}`} className={cn('flex flex-col gap-1', section.title && 'mt-3')}>
                  {section.title ? (
                    <div className="relative h-5">
                      <h2 className={cn('absolute inset-x-0 top-0 px-3 pb-0.5 text-xs font-medium text-muted-foreground', FADE(expanded))}>
                        {section.title}
                      </h2>
                      <span
                        className={cn(
                          'absolute inset-x-3 top-2 h-px bg-border transition-opacity duration-150',
                          expanded ? 'opacity-0' : 'opacity-100 delay-150',
                        )}
                        aria-hidden
                      />
                    </div>
                  ) : null}
                  {section.items.map((item) => (
                    <div key={`${section.title}-${item.href}`}>
                      {renderLink(item, section.product ? accent : homeAccent, isMobile)}
                    </div>
                  ))}
                </div>
              );
            })}
            {isAdmin ? (
              <div className="mt-3 flex flex-col gap-1">
                <h2 className={cn('h-5 px-3 pb-0.5 text-xs font-medium text-muted-foreground', FADE(expanded))}>Admin</h2>
                {[
                  { href: '/admin/view-as', label: 'View as tenant', icon: Eye },
                  { href: '/admin/ai-analytics', label: 'AI analytics', icon: Brain },
                ].map((item) => (
                  <div key={item.href}>
                    {renderLink({ ...item, show: true }, homeAccent, isMobile)}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-2 flex shrink-0 flex-col gap-1 pb-2">
            {showAddLite ? (
              <div className={cn('mb-1', expanded ? 'w-full' : 'flex w-[48px] justify-center')}>
                <AddLiteCard collapsed={!expanded} yearly={addLiteYearly} />
              </div>
            ) : null}
            {showReferral ? (
              <div className={cn('mb-1', expanded ? 'w-full' : 'flex w-[48px] justify-center')}>
                <ReferralCard collapsed={!expanded} />
              </div>
            ) : null}
            {settingsSection?.items.map((item) => <div key={item.href}>{renderLink(item, homeAccent, isMobile)}</div>)}
          </div>
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-3">
          <LookUserMenu
            userEmail={userEmail}
            viewAsActive={viewAsActive}
            triggerClassName="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left hover:bg-muted"
          >
            <Avatar name={userEmail?.split('@')[0] ?? '?'} tone="rounds" />
            <span className={cn('min-w-0 flex-1 truncate text-xs text-muted-foreground', FADE(expanded))} aria-hidden={!expanded}>
              {userEmail ?? 'Signed in'}
            </span>
            <ChevronsUpDown className={cn('size-3.5 shrink-0 text-muted-foreground', FADE(expanded))} aria-hidden />
          </LookUserMenu>
          {!isMobile ? (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-4 text-xs text-muted-foreground hover:bg-muted hover:text-foreground',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              )}
            >
              <ChevronLeft className={cn('size-4 shrink-0 transition-transform duration-300', collapsed && 'rotate-180')} aria-hidden />
              <span className={cn('whitespace-nowrap', FADE(expanded))}>Collapse</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          'hidden shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex',
          'transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[width]',
          collapsed ? 'w-[72px]' : 'w-[216px]',
        )}
      >
        {content(false)}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={(open) => !open && onMobileClose()}>
        <SheetContent side="left" showCloseButton className="w-[280px] max-w-[85vw] gap-0 border-r border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <div className="flex h-full flex-col">{content(true)}</div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
