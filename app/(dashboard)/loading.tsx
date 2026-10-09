'use client';

import { usePathname } from 'next/navigation';
import { skeletonForPath } from '@/components/layout/page-skeletons';

/**
 * Fallback while a route's own layout is still resolving (before that route's
 * loading.tsx can show). Picks the skeleton for the page being opened.
 */
export default function DashboardGroupLoading() {
  return skeletonForPath(usePathname());
}
