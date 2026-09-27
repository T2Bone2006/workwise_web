'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HistoryBackButton({
  fallbackHref,
  label = 'Back',
}: {
  fallbackHref: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 w-fit"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
    >
      <ArrowLeft className="mr-2 size-4" />
      {label}
    </Button>
  );
}
