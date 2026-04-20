'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

const ERROR_MESSAGES: Record<string, { title: string; description?: string }> = {
  not_found: { title: 'Job not found', description: 'The job may have been removed or you don’t have access.' },
  no_tenant: { title: 'No tenant assigned', description: 'Your account is not linked to a tenant.' },
  load_failed: { title: 'Failed to load job', description: 'Please try again later.' },
};

interface JobsPageErrorToastProps {
  error: string | null;
}

export function JobsPageErrorToast({ error }: JobsPageErrorToastProps) {
  const router = useRouter();

  useEffect(() => {
    if (!error) return;
    const msg = ERROR_MESSAGES[error] ?? { title: 'Something went wrong' };
    toast.error(msg.title, { description: msg.description });
    router.replace('/jobs', { scroll: false });
  }, [error, router]);

  return null;
}
