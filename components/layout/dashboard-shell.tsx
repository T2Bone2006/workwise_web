'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { ViewAsBanner } from '@/components/admin/view-as-banner';
import type { TenantFeatures } from '@/lib/data/tenant-features';

interface DashboardShellProps {
  children: React.ReactNode;
  tenantName: string;
  userEmail: string | undefined;
  isAdmin?: boolean;
  /** Sum of pending network notifications; sidebar shows a dot when > 0. */
  networkBadge?: number;
  features: TenantFeatures;
  /** When set, platform admin is viewing another tenant's dashboard. */
  viewAsTenantName?: string | null;
}

/**
 * Client wrapper that holds mobile sidebar state and composes Sidebar + Topbar + main.
 */
export function DashboardShell({
  children,
  tenantName,
  userEmail,
  isAdmin = false,
  networkBadge,
  features,
  viewAsTenantName = null,
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
        networkBadge={networkBadge}
        features={features}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {viewAsTenantName && <ViewAsBanner tenantName={viewAsTenantName} />}
        <Topbar
          tenantName={tenantName}
          userEmail={userEmail}
          onMenuClick={() => setMobileOpen(true)}
          viewAsActive={Boolean(viewAsTenantName)}
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
