'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Share2,
  Activity,
  Building2,
  Upload,
  Settings,
  ChevronLeft,
  Brain,
  Eye,
  Route,
  CalendarDays,
  Wallet,
  MessageSquare,
  Landmark,
  Receipt,
  Bot,
  Wrench,
} from 'lucide-react';
import type { TenantFeatures } from '@/lib/data/tenant-features';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const SIDEBAR_STORAGE_KEY = 'workwise-sidebar-collapsed';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  show: boolean;
};

type NavSection = {
  /** Section heading; omitted when the tenant has a single product. */
  title?: string;
  items: NavItem[];
};

/**
 * Builds the sidebar sections for the tenant's products. Every product's
 * links live under its own heading when the tenant has more than one; a
 * single-product tenant just sees a flat list.
 */
function buildNavSections(features: TenantFeatures): NavSection[] {
  const pro: NavItem[] = [
    { href: '/jobs', label: 'Jobs', icon: Briefcase, show: true },
    { href: '/workers', label: 'Workers', icon: Users, show: true },
    { href: '/network', label: 'Network', icon: Share2, show: true },
    { href: '/monitor', label: 'Monitor', icon: Activity, show: true },
    { href: '/customers', label: 'Customers', icon: Building2, show: true },
    { href: '/import', label: 'Import', icon: Upload, show: true },
  ];
  const rounds: NavItem[] = [
    { href: '/rounds/customers', label: 'Customers', icon: Route, show: true },
    { href: '/rounds/calendar', label: 'Calendar', icon: CalendarDays, show: true },
    { href: '/rounds/services', label: 'Services', icon: Wrench, show: true },
    { href: '/rounds/import', label: 'Import', icon: Upload, show: true },
    { href: '/rounds/payments', label: 'Payments', icon: Wallet, show: true },
    { href: '/rounds/bank', label: 'Bank', icon: Landmark, show: true },
    { href: '/rounds/messages', label: 'Messages', icon: MessageSquare, show: true },
    { href: '/rounds/expenses', label: 'Expenses', icon: Receipt, show: true },
  ];
  const lite: NavItem[] = [
    { href: '/lite', label: 'Leads', icon: Bot, show: true },
    { href: '/lite/conversations', label: 'Conversations', icon: MessageSquare, show: true },
    { href: '/lite/widget', label: 'Widget', icon: Settings, show: true },
  ];

  const productSections: NavSection[] = [];
  if (features.pro) productSections.push({ title: 'Pro', items: pro });
  if (features.rounds) productSections.push({ title: 'Rounds', items: rounds });
  if (features.lite) productSections.push({ title: 'Lite', items: lite });

  const single = productSections.length <= 1;
  return [
    {
      items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true }],
    },
    ...productSections.map((section) => (single ? { items: section.items } : section)),
    { items: [{ href: '/settings', label: 'Settings', icon: Settings, show: true }] },
  ];
}

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  isAdmin?: boolean;
  /** When > 0, shows a dot next to Network (or on the icon when sidebar is collapsed). */
  networkBadge?: number;
  features: TenantFeatures;
}

export function Sidebar({ mobileOpen, onMobileClose, isAdmin = false, networkBadge, features }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  const navSections = buildNavSections(features).map((section) => ({
    ...section,
    items: section.items.filter((item) => item.show),
  }));

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
    const showNetworkDot =
      item.href === '/network' && networkBadge != null && networkBadge > 0;
    const labelVisible = !collapsed || isMobile;
    const dotOnIcon = showNetworkDot && !labelVisible;
    const dotAfterLabel = showNetworkDot && labelVisible;
    const dotStyleClass =
      'size-[8px] animate-pulse rounded-full [background-image:radial-gradient(circle_at_center,#a78bfa,#6366f1)] [box-shadow:0_0_6px_1px_rgba(139,92,246,0.7)]';

    return (
      <Link
        href={item.href}
        onClick={isMobile ? onMobileClose : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
          'hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground hover:translate-x-0.5 hover:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'))
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
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main navigation">
        {navSections.map((section, index) => (
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
          'hidden md:flex md:flex-col md:shrink-0 md:relative md:overflow-hidden md:rounded-r-xl',
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
