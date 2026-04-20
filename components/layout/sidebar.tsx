'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Building2,
  Upload,
  Settings,
  ChevronLeft,
  Brain,
} from 'lucide-react';
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

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/workers', label: 'Workers', icon: Users },
  { href: '/customers', label: 'Customers', icon: Building2 },
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  isAdmin?: boolean;
}

export function Sidebar({ mobileOpen, onMobileClose, isAdmin = false }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

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

  const linkContent = (item: (typeof navItems)[number], isMobile = false) => (
    <Link
      href={item.href}
      onClick={isMobile ? onMobileClose : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
        'hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground hover:translate-x-0.5 hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        pathname === item.href
          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
          : 'text-sidebar-foreground/90'
      )}
    >
      <item.icon className="size-5 shrink-0" aria-hidden />
      {(!collapsed || isMobile) && <span>{item.label}</span>}
    </Link>
  );

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
        <AnimatePresence initial={false}>
          {(!collapsed || isMobile) && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden whitespace-nowrap text-base font-semibold text-sidebar-foreground"
            >
              WorkWise
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main navigation">
        {navItems.map((item) => (
          <div key={item.href}>{linkContent(item, isMobile)}</div>
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
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 72 : 256 }}
        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
        className="hidden md:flex md:flex-col md:shrink-0 md:border-r md:border-sidebar-border"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(var(--blur-glass))',
          WebkitBackdropFilter: 'blur(var(--blur-glass))',
          boxShadow: 'var(--shadow-glass-value)',
        }}
      >
        <div
          className="absolute inset-0 rounded-r-xl border-r border-sidebar-border pointer-events-none"
          aria-hidden
        />
        <div className="relative z-10 flex flex-1 flex-col min-h-0">
          {sidebarContent(false)}
        </div>
      </motion.aside>

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
