'use client';

import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Avatar } from '@/components/look/avatar';
import { crumbsForPath } from './page-breadcrumb';
import { LookUserMenu } from './look-user-menu';

/**
 * The new look's slim bar, for phone and tablet widths only (< 1024 px): the
 * menu button, where you are, and your account. At laptop width this band is
 * gone; the sidebar's account row takes over.
 */
export function LookTopbar({
  tenantName,
  userEmail,
  onMenuClick,
  viewAsActive = false,
}: {
  tenantName: string;
  userEmail: string | undefined;
  onMenuClick: () => void;
  viewAsActive?: boolean;
}) {
  const pathname = usePathname();
  const crumbs = crumbsForPath(pathname);
  const title = crumbs.at(-1)?.label ?? tenantName;

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
        <p className="truncate text-[11px] leading-tight text-muted-foreground">{tenantName}</p>
      </div>
      <LookUserMenu
        userEmail={userEmail}
        viewAsActive={viewAsActive}
        side="bottom"
        triggerClassName="rounded-full"
      >
        <Avatar name={userEmail?.split('@')[0] ?? '?'} tone="rounds" />
      </LookUserMenu>
    </header>
  );
}
