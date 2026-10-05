'use client';

import { Suspense, useEffect, useState } from 'react';
import { DashboardScroll } from './dashboard-scroll';
import { OverdueBanner } from './overdue-banner';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { ViewAsBanner } from '@/components/admin/view-as-banner';
import { RestartedWelcome } from '@/components/dashboard/plan-ended';
import type { TenantFeatures } from '@/lib/data/tenant-features';
import { LookAttribute } from '@/components/look/look-attribute';
import { LookProvider, type Look } from '@/components/look/use-look';
import { cn } from '@/lib/utils';

interface DashboardShellProps {
  children: React.ReactNode;
  tenantName: string;
  userEmail: string | undefined;
  isAdmin?: boolean;
  /** Sum of pending network notifications; sidebar shows a dot when > 0. */
  networkBadge?: number;
  /** Replies that need the trader; sidebar shows a dot on Messages when > 0. */
  messagesBadge?: number;
  features: TenantFeatures;
  /** When set, platform admin is viewing another tenant's dashboard. */
  viewAsTenantName?: string | null;
  /** 'new' for Rounds and Lite logins (Phase 7b), 'classic' for Pro. */
  look?: Look;
  showAddLite?: boolean;
  addLiteYearly?: boolean;
  showReferral?: boolean;
  /** Live self-serve subscription is past_due. Never set for Pro or managed businesses. */
  overdue?: boolean;
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
  messagesBadge,
  features,
  viewAsTenantName = null,
  look = 'classic',
  showAddLite = false,
  addLiteYearly = false,
  showReferral = false,
  overdue = false,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
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
  }, []);

  return (
    <LookProvider value={look}>
      <LookAttribute look={look} />
      <div
        data-look={look === 'new' ? 'new' : undefined}
        className={cn('fixed inset-0 flex overflow-clip', look === 'new' && 'bg-background text-foreground')}
      >
        <Sidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          isAdmin={isAdmin}
          networkBadge={networkBadge}
          messagesBadge={messagesBadge}
          features={features}
          tenantName={tenantName}
          userEmail={userEmail}
          viewAsActive={Boolean(viewAsTenantName)}
          showAddLite={showAddLite}
          addLiteYearly={addLiteYearly}
          showReferral={showReferral}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {viewAsTenantName && <ViewAsBanner tenantName={viewAsTenantName} />}
          <Topbar
            tenantName={tenantName}
            userEmail={userEmail}
            onMenuClick={() => setMobileOpen(true)}
            viewAsActive={Boolean(viewAsTenantName)}
          />
          {overdue ? <OverdueBanner /> : null}
          <DashboardScroll>
            <Suspense fallback={null}>
              <RestartedWelcome />
            </Suspense>
            {children}
          </DashboardScroll>
        </div>
      </div>
    </LookProvider>
  );
}
