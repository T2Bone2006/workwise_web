'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

interface DashboardShellProps {
  children: React.ReactNode;
  tenantName: string;
  userEmail: string | undefined;
  isAdmin?: boolean;
}

/**
 * Client wrapper that holds mobile sidebar state and composes Sidebar + Topbar + main.
 */
export function DashboardShell({
  children,
  tenantName,
  userEmail,
  isAdmin = false,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const dashboardHome = pathname === '/dashboard';

  return (
    <div className="flex h-screen">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        isAdmin={isAdmin}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar
          tenantName={tenantName}
          userEmail={userEmail}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main
          className={cn(
            'min-h-0 flex-1 p-6',
            dashboardHome ? 'overflow-hidden' : 'overflow-auto'
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
