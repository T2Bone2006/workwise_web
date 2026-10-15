import {
  LayoutDashboard,
  Briefcase,
  Users,
  Share2,
  Activity,
  Building2,
  Upload,
  Settings,
  CalendarDays,
  Wallet,
  MessageSquare,
  Receipt,
  Bot,
  Inbox,
  MessageCircle,
  Wrench,
  Map,
  UserRound,
  UsersRound,
} from 'lucide-react';
import type { TenantFeatures } from '@/lib/data/tenant-features';
import { litePaths } from '@/lib/navigation/lite-paths';

export const SIDEBAR_STORAGE_KEY = 'workwise-sidebar-collapsed';

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  show: boolean;
};

export type NavSection = {
  /** Section heading; omitted when the tenant has a single product. */
  title?: string;
  /** Which product the section belongs to (the new look colours by it). */
  product?: 'pro' | 'rounds' | 'lite' | 'worker';
  items: NavItem[];
};

/**
 * True when this link is the page you are on. A shorter link such as /lite
 * must not stay lit on /lite/widget — only the longest matching link does.
 */
export function isNavItemActive(pathname: string, href: string, hrefs: string[]): boolean {
  const matches =
    pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
  if (!matches) return false;
  return !hrefs.some(
    (other) =>
      other !== href &&
      other.startsWith(`${href}/`) &&
      (pathname === other || pathname.startsWith(`${other}/`))
  );
}

/**
 * Builds the sidebar sections for the tenant's products. Every product's
 * links live under its own heading when the tenant has more than one; a
 * single-product tenant just sees a flat list.
 */
/** The 'Work for …' heading; a very long business name falls back to plain 'Work'. */
export function workerSectionTitle(employer: string | null): string {
  const name = employer?.trim();
  return name && name.length <= 22 ? `Work for ${name}` : 'Work';
}

/** The worker area's four tabs. A Rounds employer's third tab says Visits (a round is visits, not jobs). */
function workerItems(employerIsRounds: boolean | undefined): NavItem[] {
  return [
    { href: '/worker', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { href: '/worker/calendar', label: 'Calendar', icon: CalendarDays, show: true },
    { href: '/worker/jobs', label: employerIsRounds ? 'Visits' : 'Jobs', icon: Briefcase, show: true },
    { href: '/worker/profile', label: 'Profile', icon: UserRound, show: true },
  ];
}

export function buildNavSections(features: TenantFeatures): NavSection[] {
  // An employee gets the worker area and nothing else: no office links, no Settings.
  if (features.workerOnly) {
    return [{ product: 'worker', items: workerItems(features.workerEmployerIsRounds) }];
  }

  const pro: NavItem[] = [
    { href: '/jobs', label: 'Jobs', icon: Briefcase, show: true },
    { href: '/jobs/calendar', label: 'Calendar', icon: CalendarDays, show: true },
    { href: '/workers', label: 'Workers', icon: Users, show: true },
    { href: '/network', label: 'Network', icon: Share2, show: true },
    { href: '/monitor', label: 'Monitor', icon: Activity, show: true },
    { href: '/customers', label: 'Customers', icon: Building2, show: true },
    { href: '/import', label: 'Import', icon: Upload, show: true },
  ];
  const rounds: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { href: '/customers', label: 'Customers', icon: Users, show: true },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays, show: true },
    { href: '/team', label: 'Team', icon: UsersRound, show: true },
    { href: '/map', label: 'Map', icon: Map, show: true },
    { href: '/services', label: 'Services', icon: Wrench, show: true },
    { href: '/payments', label: 'Payments', icon: Wallet, show: true },
    { href: '/messages', label: 'Messages', icon: MessageSquare, show: true },
    { href: '/expenses', label: 'Expenses', icon: Receipt, show: true },
  ];
  const lite: NavItem[] = [
    { href: litePaths.leads, label: 'Leads', icon: Inbox, show: true },
    { href: litePaths.conversations, label: 'Conversations', icon: MessageCircle, show: true },
    { href: litePaths.widget, label: 'Widget', icon: Bot, show: true },
  ];

  const productSections: NavSection[] = [];
  if (features.worker) {
    productSections.push({ title: workerSectionTitle(features.workerEmployer), product: 'worker', items: workerItems(features.workerEmployerIsRounds) });
  }
  if (features.pro) productSections.push({ title: 'Pro', product: 'pro', items: pro });
  if (features.rounds) productSections.push({ title: 'Rounds', product: 'rounds', items: rounds });
  if (features.lite) productSections.push({ title: 'Lite', product: 'lite', items: lite });

  // The 'Work for …' heading stays even when it is the only block: it says whose work this is.
  const single = productSections.length <= 1 && !features.worker;
  // Lite on its own has no separate home: /dashboard only redirects to Leads.
  // Rounds keeps Dashboard as the first item in that section. Pro without Rounds
  // still gets it on its own, above the product links.
  const liteOnly = features.lite && !features.rounds && !features.pro;
  return [
    ...(liteOnly || features.rounds || features.worker
      ? []
      : [{ items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true }] }]),
    ...productSections.map((section) => (single ? { product: section.product, items: section.items } : section)),
    { items: [{ href: '/settings', label: 'Settings', icon: Settings, show: true }] },
  ];
}

