'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';

interface FloatingAddButtonProps {
  href: string;
  label: string;
  desktopLabel?: boolean;
}

export function FloatingAddButton({
  href,
  label,
  desktopLabel = true,
}: FloatingAddButtonProps) {
  return (
    <Link
      href={href}
      className="fixed bottom-6 right-6 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-gradient-to-br from-[#2563EB]/90 to-[#1D4ED8]/85 text-white shadow-[0_12px_30px_-12px_rgba(29,78,216,0.75)] backdrop-blur-md transition-all hover:from-[#2563EB]/95 hover:to-[#1D4ED8]/92 hover:shadow-[0_16px_36px_-12px_rgba(29,78,216,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8]/50 sm:w-auto sm:min-w-14 sm:gap-2 sm:px-4"
      aria-label={label}
    >
      <Plus className="size-5" />
      {desktopLabel ? (
        <span className="hidden text-sm font-medium sm:inline">{label}</span>
      ) : null}
    </Link>
  );
}
