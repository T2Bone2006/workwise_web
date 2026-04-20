'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface WorkersPageErrorToastProps {
  error: string | null;
}

export function WorkersPageErrorToast({ error }: WorkersPageErrorToastProps) {
  const router = useRouter();

  useEffect(() => {
    if (!error) return;
    const decoded = decodeURIComponent(error).replace(/\+/g, ' ');
    toast.error(decoded);
    router.replace('/workers', { scroll: false });
  }, [error, router]);

  return null;
}
