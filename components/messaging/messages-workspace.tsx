'use client';

import { useMemo, type JSX, type ReactNode } from 'react';
import { useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { TextsMeterCompact } from '@/components/messaging/texts-meter';
import { ThreadList } from '@/components/messaging/thread-list';
import type { TextUsage } from '@/lib/data/messaging/texts';
import type { ThreadListItem } from '@/lib/data/messaging/threads';
import { sampleThreads } from '@/lib/messaging/sample-threads';
import { cn } from '@/lib/utils';

/**
 * The Messages screen. On a laptop the conversation list stays on the left and the open
 * conversation fills the right; on a phone they take turns (list first, then the conversation
 * with a Back button), so nothing is squeezed.
 */
export function MessagesWorkspace(props: {
  threads: ThreadListItem[];
  usage: TextUsage | null;
  usageError: string | null;
  children: ReactNode;
}): JSX.Element {
  const { threads, usage, usageError, children } = props;
  const segment = useSelectedLayoutSegment();
  const preview = useSearchParams().get('preview') === '1';
  const items = useMemo(() => (preview ? sampleThreads() : threads), [preview, threads]);
  const open = segment != null;

  return (
    <div className="space-y-5">
      <div className={cn(open && 'hidden lg:block')}>
        <PageGradientHeader
          title="Messages"
          subtitle="Replies that need a choice, and the texts you've sent."
          actions={usage ? <TextsMeterCompact usage={usage} /> : undefined}
        />
      </div>
      {usageError ? <p className="text-sm text-destructive">{usageError}</p> : null}
      {preview ? (
        <p className="text-sm text-muted-foreground">
          Samples only, so you can see every colour and state. They are not real messages.
        </p>
      ) : null}
      <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className={cn(open && 'hidden lg:block')}>
          <ThreadList
            items={items}
            activeId={segment}
            emptyText="No texts yet."
          />
        </div>
        <div className={cn('min-w-0', !open && 'hidden lg:block')}>{children}</div>
      </div>
    </div>
  );
}
