'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { revalidateMessagesInbox } from '@/lib/actions/messaging';

/** One refresh so the sidebar dot drops after this thread is marked read. */
export function RefreshAfterRead(props: { unread: number }) {
  const router = useRouter();
  useEffect(() => {
    if (props.unread <= 0) return;
    void revalidateMessagesInbox().then(() => {
      router.refresh();
    });
  }, [props.unread, router]);
  return null;
}
