'use client';

import dynamic from 'next/dynamic';
import type { CustomerPlace } from '@/components/maps/customer-places-map';

const CustomerPlacesMap = dynamic(
  () => import('@/components/maps/customer-places-map').then((mod) => mod.CustomerPlacesMap),
  { ssr: false },
);

export function CustomerPlacesMapCard({
  places,
  compact,
  className,
}: {
  places: CustomerPlace[];
  compact?: boolean;
  className?: string;
}) {
  if (places.length === 0) return null;
  return <CustomerPlacesMap places={places} compact={compact} className={className} />;
}
