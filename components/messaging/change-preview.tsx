'use client';

import type { JSX } from 'react';
import { countSegments } from '@/lib/messaging/gsm';

export function ChangePreview(props: { text: string }): JSX.Element {
  const { segments } = countSegments(props.text);
  const texts = segments === 1 ? '1 text' : `${segments} texts`;
  return (
    <div className="rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-sm">
      <p className="whitespace-pre-wrap text-foreground">{props.text}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {texts}. Customers without a mobile get it by email.
      </p>
    </div>
  );
}
