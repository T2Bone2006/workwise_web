'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { TextCustomerButton } from '@/components/messaging/text-customer-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { isUkMobileE164 } from '@/lib/messaging/phone';
import type { ThreadMessage } from '@/lib/data/messaging/threads';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';

function channelLabel(channel: ThreadMessage['channel']): string {
  if (channel === 'email') return 'Email';
  return 'Text';
}

function messageWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function oneLine(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line || '—';
}

export function CustomerMessagesCard(props: {
  name: string;
  phoneE164: string | null;
  optedOut: boolean;
  recent: { threadId: string | null; messages: ThreadMessage[] };
}): JSX.Element {
  const { name, phoneE164, optedOut, recent } = props;
  const hasMobile = isUkMobileE164(phoneE164);
  const phoneDisplay = hasMobile ? formatUkPhoneDisplay(phoneE164) : '';

  return (
    <Card className="glass-card border-border/80">
      <CardHeader className="pb-2">
        <h2 className="text-lg font-semibold">Messages</h2>
      </CardHeader>
      <CardContent className="space-y-5">
        {optedOut ? (
          <span className="inline-flex rounded-full border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200">
            Stopped texts (replied STOP)
          </span>
        ) : null}

        <TextCustomerButton phone={phoneDisplay || null} name={name} />

        <div className="space-y-2">
          {recent.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            <ul className="space-y-2">
              {recent.messages.map((message) => (
                <li key={message.id} className="flex items-baseline gap-2 text-sm">
                  <span className="w-14 shrink-0 text-xs text-muted-foreground">
                    {messageWhen(message.createdAt)}
                  </span>
                  <span className="w-10 shrink-0 text-xs font-medium">
                    {message.direction === 'outbound' ? 'You' : 'Them'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{oneLine(message.body)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {channelLabel(message.channel)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {recent.threadId ? (
            <Button variant="link" className="h-auto px-0" asChild>
              <Link href={`/messages/${recent.threadId}`}>Open conversation</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
