'use client';

import Link from 'next/link';
import { litePaths } from '@/lib/navigation/lite-paths';
import { cn } from '@/lib/utils';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'details', label: 'Left details' },
  { id: 'no_details', label: 'No details' },
  { id: 'out_of_area', label: 'Out of area' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

function href(filter: FilterId): string {
  if (filter === 'all') return litePaths.conversations;
  return `${litePaths.conversations}?filter=${filter}`;
}

export function ConversationFilters({ filter }: { filter: FilterId }) {
  return (
    <nav aria-label="Filter chats" className="flex flex-wrap gap-2">
      {FILTERS.map((item) => {
        const on = item.id === filter;
        return (
          <Link
            key={item.id}
            href={href(item.id)}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
              on
                ? 'border-(--look-lite) bg-(--look-lite-pill) text-white'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
